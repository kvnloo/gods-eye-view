import { t, msg, onLocaleChange } from '../i18n/index.js';
import {
  createCityDocument,
  addCityAlternative,
  reviseCityAlternative,
  attachCityConcept,
  parseCityDocument,
  serializeCityDocument,
  replayCityDocument,
  cityAlternatives,
} from '../data/cityPlanningDocument.js';
import { presentCommunityPlanningPreview } from './communityPlanningPreview.js';

const KEY = 'godsEyeView.cityBuilder.v1';
const freshEditor = () => ({
  id: null,
  parentRevision: null,
  projectTitle: '',
  title: '',
  description: '',
  parameters: { kind: 'park', trees: 20, widthMeters: 2, shadePercent: 40 },
});

/** Own a local possible-world document. Only the explicit Imagine action calls a provider. */
export function createCityBuilder({
  publish,
  offerLauncher,
  captureReference,
  storage,
  generator,
  download,
  sharingDialogOpen = () => false,
  uid = () => `city-${crypto.randomUUID()}`,
  canLocal = false,
}) {
  let document = null;
  let observed = null;
  let storageBlocked = false;
  let persisted = false;
  let error = null;
  let status = null;
  let editor = freshEditor();
  let opened = false;
  let disposed = false;
  let pending = null;
  let mode = 'co-op';
  let focusedId = null;
  let provider = 'fixture';
  try {
    observed = storage.getItem(KEY);
    if (observed !== null) {
      document = parseCityDocument(observed);
      persisted = true;
    }
  } catch {
    storageBlocked = true;
    error = msg(
      'Saved City builder data is unreadable. Import a valid project to replace it.',
    );
  }
  function present() {
    if (disposed) return;
    offerLauncher({ label: t('City builder') });
    if (!opened) {
      publish(null);
      return;
    }
    let view = {
      title: t('City builder'),
      intro: t('Start a community project over the current globe view.'),
      localOnly: t(
        'LOCAL-ONLY DISPLAY · No shared room, live participants or synchronized edits.',
      ),
      sources: [],
      compareNote: '',
      recordSummary: '',
      unavailable: null,
      cards: [],
      inspect: [],
      gameDisabled: true,
      gameDisabledReason: t('At least two valid alternatives are required'),
      mode,
      modeStatus: '',
      status: '',
      additional: null,
      excluded: null,
    };
    const alternatives = document
      ? cityAlternatives(document).map((a) => ({
          ...a,
          history: document.alternatives.find((b) => b.id === a.id).versions,
        }))
      : [];
    if (document) {
      const collaborationState = replayCityDocument(document).state;
      view = presentCommunityPlanningPreview(
        { project: document.project, collaborationState },
        { mode, focusedId },
      );
      view.title = t('City builder');
      view.status = t(
        'Hypothetical proposals only. No approval, live signals or predicted impacts.',
      );
      // The historical fixture compares two records. The builder offers every authored alternative.
      view.additional = null;
      view.recordSummary = t(
        'Versioned possible worlds. Observed facts and approvals remain unchanged.',
      );
      const baseCards = new Map(view.cards.map((card) => [card.id, card]));
      view.cards = alternatives.map((a) => {
        let card = baseCards.get(a.id);
        if (!card) {
          const authored = Object.fromEntries(
            Object.entries(collaborationState.authored).filter(([, entry]) =>
              entry.targetId.endsWith(`:${a.id}`),
            ),
          );
          card = presentCommunityPlanningPreview({
            project: document.project,
            collaborationState: { ...collaborationState, authored },
          }).cards[0];
        }
        return {
          ...card,
          label: a.title,
          description: a.description,
          concept: a.concept,
          hidden:
            mode === 'game' && a.id !== (focusedId ?? alternatives[0]?.id),
        };
      });
      if (mode === 'game') {
        const focused = alternatives.find(
          (a) => a.id === (focusedId ?? alternatives[0]?.id),
        );
        view.modeStatus = t(
          'View: game · inspecting {proposal} (hypothetical) · neither mode grants authority',
          { proposal: focused?.title ?? '' },
        );
      }
      view.inspect =
        mode === 'game'
          ? alternatives.map((a) => ({
              id: a.id,
              label: a.title,
              pressed: a.id === (focusedId ?? alternatives[0]?.id),
            }))
          : [];
    }
    view.city = {
      projectTitle: document?.project.title ?? null,
      reference: document?.reference ?? null,
      alternatives,
      editor: { ...editor, parameters: { ...editor.parameters } },
      pending: Boolean(pending),
      status: status && t(status),
      error: error && t(error),
      provider,
      canLocal,
      persisted,
    };
    publish(view);
  }
  function commit(next, { importing = false } = {}) {
    const json = serializeCityDocument(next);
    // Never overwrite unreadable storage or a different tab's newer document.
    if (storageBlocked && !importing) throw new Error('storage blocked');
    try {
      if (storage.getItem(KEY) !== observed) {
        error = msg(
          'Another tab changed this project. Reload before saving; export keeps your draft.',
        );
        document = next;
        persisted = false;
        return;
      }
      storage.setItem(KEY, json);
      observed = json;
      storageBlocked = false;
      persisted = true;
    } catch {
      persisted = false;
      error = msg(
        'Local storage is unavailable or full. Export the project to keep your changes.',
      );
    }
    document = next;
  }
  function mutate(action) {
    if (disposed || !opened || pending) return;
    error = null;
    status = null;
    try {
      action();
    } catch {
      error = msg(
        'Could not save this change. Check the fields and current revision.',
      );
    }
    present();
  }
  function cancel() {
    pending?.abort();
    pending = null;
  }
  const controls = {
    open() {
      if (disposed || opened || sharingDialogOpen()) return;
      opened = true;
      present();
    },
    close() {
      if (disposed) return;
      opened = false;
      cancel();
      present();
    },
    async start({ title }) {
      if (disposed || !opened || pending || document) return;
      if (storageBlocked) {
        present();
        return;
      }
      const request = new AbortController();
      pending = request;
      error = null;
      present();
      try {
        const reference = await captureReference();
        if (disposed || request.signal.aborted || pending !== request) return;
        commit(createCityDocument({ id: uid(), title, reference }));
        editor = freshEditor();
        status = msg(
          'Reference captured. Author at least two possible worlds to compare.',
        );
      } catch {
        if (!request.signal.aborted)
          error = msg(
            'Could not capture this view. Zoom to a place, stop moving, and try again.',
          );
      } finally {
        if (pending === request) {
          pending = null;
          present();
        }
      }
    },
    editField(name, value) {
      if (disposed || !opened || pending) return;
      if (['title', 'description', 'projectTitle'].includes(name))
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
      present();
    },
    saveAlternative() {
      mutate(() => {
        if (!document) return;
        const edit = {
          title: editor.title,
          description: editor.description,
          parameters: editor.parameters,
        };
        const id = editor.id ?? `world-${document.alternatives.length + 1}`;
        commit(
          editor.id
            ? reviseCityAlternative(document, id, editor.parentRevision, edit)
            : addCityAlternative(document, { id, ...edit }),
        );
        const saved = cityAlternatives(document).find((a) => a.id === id);
        editor = { ...editor, id, parentRevision: saved.revision };
      });
    },
    newAlternative() {
      mutate(() => {
        editor = freshEditor();
      });
    },
    editAlternative(id) {
      mutate(() => {
        const a = cityAlternatives(document).find((a) => a.id === id);
        if (!a) return;
        editor = {
          ...freshEditor(),
          id,
          parentRevision: a.revision,
          title: a.title,
          description: a.description,
          parameters: a.parameters,
        };
      });
    },
    restoreRevision(id, revision) {
      mutate(() => {
        const a = document.alternatives.find((a) => a.id === id);
        const version = a?.versions.find((v) => v.revision === revision);
        if (!version) return;
        commit(
          reviseCityAlternative(document, id, a.versions.length, {
            title: version.title,
            description: version.description,
            parameters: version.parameters,
          }),
        );
        editor = freshEditor();
      });
    },
    setMode(next) {
      if (
        next === 'co-op' ||
        (next === 'game' && document?.alternatives.length >= 2)
      ) {
        mode = next;
        present();
      }
    },
    inspect(id) {
      if (document?.alternatives.some((a) => a.id === id)) {
        focusedId = id;
        present();
      }
    },
    setProvider(next) {
      if (!pending && (next === 'fixture' || (next === 'local' && canLocal))) {
        provider = next;
        present();
      }
    },
    async imagine(id) {
      if (disposed || !opened || pending || !document) return;
      const a = cityAlternatives(document).find((a) => a.id === id);
      if (!a || a.concept) return;
      const original = document;
      const request = new AbortController();
      pending = request;
      error = null;
      present();
      try {
        // Use the immutable captured globe pixels. A later camera move cannot change the reference.
        const concept = await generator({ provider }).generate(
          {
            description: a.description,
            parameters: a.parameters,
            sourceView: original.reference,
          },
          { signal: request.signal },
        );
        if (
          disposed ||
          request.signal.aborted ||
          pending !== request ||
          document !== original
        )
          return;
        commit(attachCityConcept(document, id, a.revision, concept));
        focusedId = id;
        status = msg(
          'Concept ready. AI imagery does not establish feasibility or approval.',
        );
      } catch {
        if (!request.signal.aborted)
          error = msg(
            'Concept generation failed. Check the local provider and try again explicitly.',
          );
      } finally {
        if (pending === request) {
          pending = null;
          present();
        }
      }
    },
    async importFile(file) {
      if (disposed || !opened || pending) return;
      const request = new AbortController();
      pending = request;
      error = null;
      present();
      try {
        if (!file || file.size > 4 * 1024 * 1024) throw new Error('file limit');
        const next = parseCityDocument(await file.text());
        if (disposed || request.signal.aborted || pending !== request) return;
        commit(next, { importing: true });
        editor = freshEditor();
        focusedId = null;
        mode = 'co-op';
        status = msg(
          'Project imported. Citations and authorship remain unverified.',
        );
      } catch {
        if (!request.signal.aborted)
          error = msg(
            'Invalid project file. Nothing was imported or sent to a provider.',
          );
      } finally {
        if (pending === request) {
          pending = null;
          present();
        }
      }
    },
    exportFile() {
      if (!disposed && document)
        download(
          serializeCityDocument(document),
          `${document.project.id}.json`,
        );
    },
    destroy() {
      if (disposed) return;
      cancel();
      stopLocale();
      publish(null);
      offerLauncher(null);
      disposed = true;
      document = null;
    },
  };
  const stopLocale = onLocaleChange(present);
  present();
  return controls;
}
