import { t, msg } from '../i18n/index.js';
import {
  createRoomOperation,
  mergeRoomOperations,
  parseRoom,
  projectRoom,
  roomDigest,
  serializeRoom,
} from '../data/cityRoom.js';
import { displayName, normalizeRoomCode } from '../data/localRoom.js';

const KEY = 'godsEyeView.cityRoom.v1';
const SEARCH_MS = 4000;
const freshEditor = () => ({
  mode: 'new',
  alternativeId: null,
  parents: [],
  branchedFrom: null,
  title: '',
  description: '',
  parameters: { kind: 'park', trees: 20, widthMeters: 2, shadePercent: 40 },
});
const ROLE_LABELS = {
  owner: msg('Owner'),
  contributor: msg('Contributor'),
  viewer: msg('Viewer'),
  revoked: msg('Access revoked'),
};
const REASONS = {
  viewer: msg('viewers cannot change the room'),
  revoked: msg('contributor access was revoked'),
  'not-owner': msg('only the owner assigns roles'),
  'unknown-parent': msg('the revision it builds on is unknown'),
  'unknown-version': msg('the revision it refers to is unknown'),
  'unknown-source': msg('the revision it branches from is unknown'),
  'parent-rejected': msg('it builds on a rejected change'),
  'duplicate-genesis': msg('another room already uses this code'),
  limit: msg('the room limit was reached'),
};
const tag = (actorId) => actorId.slice(-4);

/**
 * One tab's participation in a local City builder room. The City builder
 * owner composes it and renders `view()`; this session never publishes.
 * The replica and this tab's pseudonymous identity stay in sessionStorage so
 * a reload can reconnect. Presence carries only a display name and the
 * proposal being inspected, never a camera or location.
 */
export function createCityRoomSession({
  storage,
  openRoom,
  claimIdentity = async () => ({ release() {} }),
  randomId,
  download,
  changed,
  timers = globalThis,
}) {
  let session = null;
  let channel = null;
  let lease = null;
  let peers = new Map();
  let viewing = null;
  let editor = freshEditor();
  let draft = { name: '', room: '' };
  let status = null;
  let error = null;
  let searching = null;
  let connecting = false;
  let claiming = null;
  let pendingShare = null;
  let disposed = false;
  let cache = { ops: null, projection: null };
  try {
    const saved = JSON.parse(storage.getItem(KEY));
    if (saved) {
      const ops = mergeRoomOperations([], saved.ops, { room: saved.room }).ops;
      if (
        normalizeRoomCode(saved.room) === saved.room &&
        typeof saved.archive === 'boolean' &&
        (saved.archive
          ? saved.identity === null
          : /^p-[a-z0-9]{6,16}$/.test(saved.identity?.actorId) &&
            displayName(saved.identity?.name) === saved.identity.name)
      )
        session = {
          room: saved.room,
          identity: saved.identity,
          ops,
          archive: saved.archive,
        };
    }
  } catch {
    session = null;
  }

  queueMicrotask(() => {
    if (session && !session.archive) claim();
  });

  function projection() {
    if (!session) return null;
    if (cache.ops !== session.ops)
      cache = { ops: session.ops, projection: projectRoom(session.ops) };
    return cache.projection;
  }
  function persist() {
    try {
      if (session)
        storage.setItem(
          KEY,
          JSON.stringify({
            room: session.room,
            identity: session.identity,
            ops: session.ops,
            archive: session.archive,
          }),
        );
      else storage.removeItem(KEY);
      return true;
    } catch {
      error = msg(
        'This tab could not keep the room. Export it to keep a copy.',
      );
      return false;
    }
  }
  function absorb(incoming) {
    const own = session.ops.find((op) => op.type === 'genesis');
    // A second room that reused this code never replaces the room held here.
    const accepted = own
      ? incoming.filter((op) => op?.type !== 'genesis' || op.id === own.id)
      : incoming;
    const merged = mergeRoomOperations(session.ops, accepted, {
      room: session.room,
    });
    if (!merged.changed) return false;
    session = { ...session, ops: merged.ops };
    persist();
    if (searching !== null && projection().status === 'ready') {
      stopSearching();
      status = null;
    }
    return true;
  }
  function presence() {
    return { name: session.identity.name, viewing };
  }
  function stopSearching() {
    if (searching !== null) timers.clearTimeout(searching);
    searching = null;
  }
  function disconnect(notify = true) {
    stopSearching();
    pendingShare = null;
    const open = channel;
    channel = null;
    peers = new Map();
    open?.close('left', notify);
  }
  function release() {
    lease?.release();
    lease = null;
    claiming = null;
  }
  function rotate() {
    release();
    session = {
      ...session,
      identity: { actorId: randomId(), name: session.identity.name },
    };
    persist();
    status = msg(
      'This identity is open in another tab. You joined as a new participant.',
    );
  }
  /**
   * Hold this tab's identity for as long as it holds the room, online or not,
   * so a duplicated tab can never write under the same author sequence.
   */
  function claim() {
    if (lease || !session || session.archive) return Promise.resolve(lease);
    claiming ??= (async () => {
      const wanted = session.identity.actorId;
      let held = await claimIdentity(wanted);
      if (!held && !disposed && session?.identity.actorId === wanted) {
        rotate();
        held = await claimIdentity(session.identity.actorId);
      }
      if (disposed || !session || session.archive) {
        held?.release();
        return null;
      }
      lease = held;
      claiming = null;
      changed();
      return lease;
    })();
    return claiming;
  }
  async function connect() {
    if (disposed || !session || session.archive || channel || connecting)
      return;
    connecting = true;
    error = null;
    changed();
    try {
      await claim();
      if (disposed || !session || session.archive || !lease) return;
      const opened = openRoom({
        room: session.room,
        peer: session.identity.actorId,
        presence,
        onPacket(packet) {
          if (packet.kind === 'join' && session.ops.length)
            channel?.send('ops', { ops: session.ops });
          if (packet.kind === 'ops' && absorb(packet.ops)) changed();
          // Only an existing room blocks a share; an early joiner does not.
          if (pendingShare && session.ops.some((op) => op.type === 'genesis'))
            abandonShare();
        },
        onPeers(next) {
          peers = next;
          changed();
        },
        onClosed(reason) {
          const wasOpen = Boolean(channel);
          channel = null;
          peers = new Map();
          if (reason === 'duplicate-identity' && session && !disposed) {
            // Without Web Locks the newcomer yields: new identity, then rejoin.
            rotate();
            queueMicrotask(() => connect());
          }
          if (wasOpen) changed();
        },
      });
      if (!opened) throw new Error('room unavailable');
      // A duplicate identity, an occupied room code or teardown can end the
      // attempt while the channel opens.
      if (opened.closed) return;
      if (disposed || !session) {
        opened.close('left');
        return;
      }
      channel = opened;
      if (pendingShare) {
        searching = timers.setTimeout(finishShare, SEARCH_MS);
        return;
      }
      if (session.ops.length) channel.send('ops', { ops: session.ops });
      if (projection().status !== 'ready') {
        status = msg('Looking for this room in this browser…');
        searching = timers.setTimeout(() => {
          searching = null;
          if (channel && projection()?.status !== 'ready') {
            status = msg(
              'No room found. Rooms connect only tabs of this browser on this device; ask for an exported room file instead.',
            );
            changed();
          }
        }, SEARCH_MS);
      }
    } catch {
      channel = null;
      error = msg('Local rooms are unavailable in this browser.');
    } finally {
      connecting = false;
      changed();
    }
  }
  function write(type, payload) {
    if (!session || session.archive) return null;
    if (!lease) {
      error = msg('This tab is still claiming its room identity. Try again.');
      return null;
    }
    const self = projection();
    if (type !== 'genesis') {
      const role = self.members.find(
        (m) => m.actorId === session.identity.actorId,
      )?.role;
      if (
        type === 'role'
          ? role !== 'owner'
          : !['owner', 'contributor'].includes(role)
      ) {
        error = msg('Your role cannot make this change.');
        return null;
      }
    }
    const op = createRoomOperation(
      session.ops,
      { ...session.identity, room: session.room },
      type,
      payload,
    );
    const merged = mergeRoomOperations(session.ops, [op]);
    if (!merged.added) {
      error = msg('the room limit was reached');
      return null;
    }
    session = { ...session, ops: merged.ops };
    // Keep the replica before any other tab can see the operation.
    persist();
    channel?.send('ops', { ops: [op] });
    return op;
  }
  function act(run) {
    if (disposed) return;
    error = null;
    status = null;
    try {
      run();
    } catch {
      error ??= msg('Could not make this room change. Check the fields.');
    }
    changed();
  }
  function begin(next, ops, message) {
    disconnect();
    release();
    session = next;
    session.ops = mergeRoomOperations([], ops, { room: next.room }).ops;
    editor = freshEditor();
    viewing = null;
    status = message;
    persist();
  }
  // A room code another tab already answers for is never taken over.
  function abandonShare() {
    pendingShare = null;
    disconnect();
    release();
    session = null;
    persist();
    status = null;
    error = msg(
      'This room code is already in use in this browser. Join it or choose another code.',
    );
    changed();
  }
  function finishShare() {
    searching = null;
    const document = pendingShare;
    pendingShare = null;
    if (!document || !session || !channel) return;
    const author = { ...session.identity, room: session.room };
    let ops = [
      createRoomOperation([], author, 'genesis', {
        project: { id: document.project.id, title: document.project.title },
        reference: document.reference,
      }),
    ];
    for (const alternative of document.alternatives) {
      const latest = alternative.versions.at(-1);
      ops = mergeRoomOperations(ops, [
        createRoomOperation(ops, author, 'propose', {
          title: latest.title,
          description: latest.description,
          parameters: latest.parameters,
        }),
      ]).ops;
    }
    session = {
      ...session,
      ops: mergeRoomOperations(session.ops, ops, { room: session.room }).ops,
    };
    persist();
    channel.send('ops', { ops: session.ops });
    status = msg(
      'Room created. Other tabs in this browser can join with its code.',
    );
    changed();
  }
  function version(id) {
    for (const alternative of projection()?.alternatives ?? [])
      for (const entry of alternative.versions)
        if (entry.id === id) return { alternative, entry };
    return null;
  }
  const parametersFrom = (entry) => ({ ...entry.parameters });

  const controls = {
    editDraft(field, value) {
      if (field === 'name' || field === 'room')
        draft = { ...draft, [field]: String(value) };
      changed();
    },
    share(document) {
      act(() => {
        const name = displayName(draft.name);
        const room = normalizeRoomCode(draft.room);
        if (!name || !room || !document) {
          error = msg(
            'Enter your display name and a room code of 3 to 24 lowercase letters, digits or hyphens.',
          );
          return;
        }
        // Validate the reference before anything is announced.
        createRoomOperation([], { actorId: 'p-check000001', name, room }, 'genesis', {
          project: { id: document.project.id, title: document.project.title },
          reference: document.reference,
        });
        begin(
          { room, identity: { actorId: randomId(), name }, ops: [], archive: false },
          [],
          msg('Checking that this room code is free in this browser…'),
        );
        pendingShare = document;
        connect();
      });
    },
    join() {
      act(() => {
        const name = displayName(draft.name);
        const room = normalizeRoomCode(draft.room);
        if (!name || !room) {
          error = msg(
            'Enter your display name and a room code of 3 to 24 lowercase letters, digits or hyphens.',
          );
          return;
        }
        begin(
          {
            room,
            identity: { actorId: randomId(), name },
            ops: [],
            archive: false,
          },
          [],
          null,
        );
        connect();
      });
    },
    reconnect() {
      act(() => connect());
    },
    leave() {
      act(() => {
        disconnect();
        status = msg(
          'Offline. Your changes stay in this tab and are shared when you reconnect.',
        );
      });
    },
    close() {
      act(() => {
        disconnect();
        release();
        session = null;
        editor = freshEditor();
        persist();
      });
    },
    inspect(alternativeId) {
      viewing = projection()?.alternatives.some((a) => a.id === alternativeId)
        ? alternativeId
        : null;
      channel?.announce();
      changed();
    },
    setRole(member, role) {
      act(() => {
        const entry = projection().members.find((m) => m.actorId === member);
        const online = peers.get(member);
        write('role', {
          member,
          memberName: entry?.name ?? online?.name,
          role,
        });
      });
    },
    editField(name, value) {
      if (['title', 'description'].includes(name))
        editor = { ...editor, [name]: String(value) };
      else if (['kind', 'trees', 'widthMeters', 'shadePercent'].includes(name))
        editor = {
          ...editor,
          parameters: {
            ...editor.parameters,
            [name]:
              name === 'kind' ? value : value === '' ? NaN : Number(value),
          },
        };
      changed();
    },
    newProposal() {
      act(() => {
        editor = freshEditor();
      });
    },
    edit(versionId) {
      act(() => {
        const found = version(versionId);
        if (!found) return;
        editor = {
          mode: 'revise',
          alternativeId: found.alternative.id,
          parents: [versionId],
          branchedFrom: null,
          title: found.entry.title,
          description: found.entry.description,
          parameters: parametersFrom(found.entry),
        };
      });
    },
    branch(versionId) {
      act(() => {
        const found = version(versionId);
        if (!found) return;
        editor = {
          mode: 'branch',
          alternativeId: null,
          parents: [],
          branchedFrom: versionId,
          title: found.entry.title,
          description: found.entry.description,
          parameters: parametersFrom(found.entry),
        };
      });
    },
    save() {
      act(() => {
        const edit = {
          title: editor.title,
          description: editor.description,
          parameters: editor.parameters,
        };
        const op =
          editor.mode === 'revise'
            ? write('revise', {
                alternativeId: editor.alternativeId,
                parents: editor.parents,
                ...edit,
              })
            : write('propose', { ...edit, branchedFrom: editor.branchedFrom });
        if (!op) return;
        editor = freshEditor();
        status = msg('Shared with the room.');
      });
    },
    keep(alternativeId, versionId) {
      act(() => {
        const found = version(versionId);
        if (!found || found.alternative.id !== alternativeId) return;
        if (
          write('revise', {
            alternativeId,
            parents: found.alternative.heads,
            title: found.entry.title,
            description: found.entry.description,
            parameters: parametersFrom(found.entry),
          })
        )
          status = msg('Conflict resolved by an explicit decision.');
      });
    },
    comment(versionId, text) {
      let ok = false;
      act(() => {
        ok = Boolean(write('comment', { versionId, body: text }));
      });
      return ok;
    },
    exportRoom() {
      if (session?.ops.length)
        download(serializeRoom(session.ops), `${session.room}-room.json`);
    },
    async importRoom(file) {
      if (disposed) return;
      error = null;
      status = null;
      try {
        if (!file || file.size > 4 * 1024 * 1024) throw new Error('file limit');
        const ops = parseRoom(await file.text());
        if (disposed) return;
        // An import is a read-only archive; it never merges into a live room.
        begin(
          { room: ops[0].room, identity: null, ops: [], archive: true },
          ops,
          msg(
            'Imported room archive (read-only). Recorded names are not verified.',
          ),
        );
      } catch {
        error = msg('Invalid room file. Nothing was imported.');
      }
      changed();
    },
    destroy() {
      disposed = true;
      disconnect(true);
      release();
    },
  };

  function versionView(entry, alternative, room, self) {
    const credit = (person) => `${person.name} · ${tag(person.actorId)}`;
    return {
      id: entry.id,
      number: entry.number,
      title: entry.title,
      description: entry.description,
      parameters: entry.parameters,
      author: credit(entry.author),
      authorName: entry.author.name,
      credit: entry.kept
        ? t('Written by {writer}, kept by {decider}', {
            writer: credit(entry.kept.author),
            decider: credit(entry.author),
          })
        : entry.parents.length
          ? t('Revision {number} by {author}, from revision {from}', {
              number: entry.number,
              author: credit(entry.author),
              from: entry.parents
                .map(
                  (id) => alternative.versions.find((v) => v.id === id)?.number,
                )
                .join(', '),
            })
          : t('Revision {number} by {author}', {
              number: entry.number,
              author: credit(entry.author),
            }),
      head: alternative.heads.includes(entry.id),
      comments: entry.comments.map((note) => ({
        id: note.id,
        author: credit(note.author),
        body: note.body,
      })),
      canKeep:
        self.canWrite &&
        alternative.conflict &&
        alternative.heads.includes(entry.id),
    };
  }

  function view({ canShare = false } = {}) {
    const live = Boolean(session);
    const base = {
      active: live,
      archive: Boolean(session?.archive),
      saved: live && !session.archive && !channel,
      connected: Boolean(channel),
      connecting,
      canShare,
      draft: { ...draft },
      status: status && t(status),
      error: error && t(error),
    };
    if (!session) return base;
    const room = projection();
    const actorId = session.identity?.actorId ?? null;
    const selfMember = room.members.find((m) => m.actorId === actorId);
    const role = session.archive ? 'viewer' : (selfMember?.role ?? 'viewer');
    const self = {
      actorId,
      name: session.identity?.name ?? null,
      role,
      roleLabel: t(ROLE_LABELS[role]),
      canWrite:
        !session.archive &&
        room.status === 'ready' &&
        (role === 'owner' || role === 'contributor'),
    };
    const titleOf = (alternativeId) => {
      const alternative = room.alternatives.find((a) => a.id === alternativeId);
      const latest = alternative?.versions.find((v) =>
        alternative.heads.includes(v.id),
      );
      return latest?.title ?? null;
    };
    const known = new Set(room.members.map((m) => m.actorId));
    const members = [
      ...room.members,
      ...[...peers]
        .filter(([id]) => !known.has(id))
        .map(([id, entry]) => ({
          actorId: id,
          name: entry.name,
          role: 'viewer',
        })),
    ].map((member) => {
      const online =
        member.actorId === actorId
          ? Boolean(channel)
          : peers.has(member.actorId);
      const looking =
        member.actorId === actorId
          ? viewing
          : peers.get(member.actorId)?.viewing;
      return {
        actorId: member.actorId,
        name: member.name,
        tag: tag(member.actorId),
        role: member.role,
        roleLabel: t(ROLE_LABELS[member.role]),
        isSelf: member.actorId === actorId,
        presence: online
          ? looking && titleOf(looking)
            ? t('online · viewing {proposal}', { proposal: titleOf(looking) })
            : t('online')
          : t('offline'),
        roles:
          self.role === 'owner' && !session.archive && member.role !== 'owner'
            ? ['contributor', 'viewer', 'revoked'].filter(
                (r) => r !== member.role,
              )
            : [],
      };
    });
    const credit = (person) => `${person.name} · ${tag(person.actorId)}`;
    return {
      ...base,
      room: room.room,
      digest: roomDigest(room),
      ready: room.status === 'ready',
      projectTitle: room.project?.title ?? null,
      reference: room.reference,
      self,
      owner: room.owner && credit(room.owner),
      members,
      alternatives: room.alternatives.map((alternative) => {
        const heads = alternative.versions.filter((v) =>
          alternative.heads.includes(v.id),
        );
        return {
          id: alternative.id,
          title: heads.map((v) => v.title).join(' / '),
          conflict: alternative.conflict,
          conflictText: alternative.conflict
            ? t(
                'Conflict: {count} revisions were made from the same version. Nothing was merged; choose one to keep.',
                { count: heads.length },
              )
            : null,
          createdBy: t('Proposed by {author}', {
            author: credit(alternative.createdBy),
          }),
          branchedFrom: !alternative.branchedFrom
            ? null
            : alternative.branchedFrom.available
              ? t('Branched from {author}’s “{title}” revision {number}', {
                  author: credit(alternative.branchedFrom.author),
                  title: alternative.branchedFrom.title,
                  number: alternative.branchedFrom.number,
                })
              : t('Branched from a revision that was later rejected'),
          heads: heads.map((v) => versionView(v, alternative, room, self)),
          versions: alternative.versions.map((v) =>
            versionView(v, alternative, room, self),
          ),
          inspected: viewing === alternative.id,
        };
      }),
      rejected: room.rejected.map((entry) => ({
        id: entry.id,
        text: t('Rejected: {author}’s {change} — {reason}', {
          author: credit(entry.author),
          change: entry.title ? `“${entry.title}”` : t('change'),
          reason: t(REASONS[entry.reason] ?? msg('it failed validation')),
        }),
      })),
      pending: room.pending.length,
      editor: { ...editor, parameters: { ...editor.parameters } },
    };
  }

  return {
    controls,
    view,
    get active() {
      return Boolean(session);
    },
  };
}
