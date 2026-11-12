<script setup>
import { reactive } from 'vue';
import { t } from '../../../i18n/index.js';
import UiButton from '../../kit/UiButton.vue';
import UiSelect from '../../kit/UiSelect.js';

const props = defineProps({
  room: { type: Object, required: true },
  controls: { type: Object, default: null },
});

// Unsent comment text per revision is view state; sending goes to the owner.
const drafts = reactive({});
function sendComment(versionId) {
  if (props.controls?.comment(versionId, drafts[versionId] ?? ''))
    drafts[versionId] = '';
}
function importRoom(event) {
  const file = event.target.files?.[0];
  event.target.value = '';
  if (file) props.controls?.importRoom(file);
}
const kindLabel = (kind) =>
  kind === 'park' ? t('Park') : kind === 'bike-lane' ? t('Bike lane') : t('Plaza');
const roleAction = (role) =>
  role === 'contributor'
    ? t('Make contributor')
    : role === 'viewer'
      ? t('Make viewer')
      : t('Revoke access');
const box = { border: '1px solid #397080', borderRadius: '6px', padding: '10px 12px', margin: '10px 0', background: '#0b1d27' };
const conflictBox = { ...box, borderColor: '#d5b67b', background: '#2a210f' };
const rejectedStyle = { color: '#f2a59a' };
</script>

<template>
  <section class="city-room" data-city-room :data-city-room-digest="room.digest" :data-city-room-role="room.self?.role" :aria-label="t('Shared room')">
    <h3>{{ t('Shared room') }}</h3>
    <p data-city-room-scope>{{ t('Rooms connect only tabs of this browser on this device. Presence shows who is here and which proposal they view, never anyone’s location. Names are self-reported and not verified.') }}</p>
    <form v-if="!room.active" class="city-room-entry" @submit.prevent>
      <label for="city-room-name">{{ t('Your display name') }}</label>
      <input id="city-room-name" class="scene-shot-rename city-builder-input" type="text" maxlength="40" :value="room.draft.name" @input="controls?.editDraft('name', $event.target.value)">
      <label for="city-room-code">{{ t('Room code') }}</label>
      <input id="city-room-code" class="scene-shot-rename city-builder-input" type="text" maxlength="24" :value="room.draft.room" @input="controls?.editDraft('room', $event.target.value)">
      <UiButton class="gev-action-button" data-city-room-share :disabled="!room.canShare" @click="controls?.share()">{{ t('Share this project in a room') }}</UiButton>
      <UiButton class="gev-action-button" data-city-room-join @click="controls?.join()">{{ t('Join room') }}</UiButton>
      <label for="city-room-import">{{ t('Open exported room') }}</label>
      <input id="city-room-import" type="file" accept=".json,application/json" @change="importRoom">
    </form>
    <template v-else>
      <p data-city-room-summary>
        <strong>{{ t('Room {room}', { room: room.room }) }}</strong>
        {{ room.archive ? t('Read-only archive') : room.connected ? t('Connected') : room.connecting ? t('Connecting…') : t('Offline') }}
      </p>
      <p v-if="room.self?.name" data-city-room-self>{{ t('You are {name} · {role}', { name: room.self.name, role: room.self.roleLabel }) }}</p>
      <div class="city-room-actions">
        <UiButton v-if="room.connected" class="gev-action-button" data-city-room-leave @click="controls?.leave()">{{ t('Go offline') }}</UiButton>
        <UiButton v-if="room.saved" class="gev-action-button" data-city-room-reconnect :disabled="room.connecting" @click="controls?.reconnect()">{{ t('Reconnect') }}</UiButton>
        <UiButton class="gev-action-button" data-city-room-export :disabled="!room.ready" @click="controls?.exportRoom()">{{ t('Export room') }}</UiButton>
        <UiButton class="gev-action-button" data-city-room-close @click="controls?.close()">{{ t('Close room') }}</UiButton>
      </div>
      <figure v-if="room.reference" data-city-room-reference style="margin: 8px 0">
        <img :src="room.reference.image" :alt="t('Captured baseline reference')" style="display: block; max-width: 100%; max-height: 180px; object-fit: contain">
        <figcaption>{{ t('{project} · reference-only baseline shared by the owner', { project: room.projectTitle }) }}</figcaption>
      </figure>
      <div :style="box" data-city-room-members>
        <h4>{{ t('Participants') }}</h4>
        <ul>
          <li v-for="member in room.members" :key="member.actorId" :data-city-room-member="member.actorId" :data-city-room-member-role="member.role">
            <strong>{{ member.name }}</strong> <code :title="t('Pseudonymous tab tag')">{{ member.tag }}</code> <span data-city-room-member-label>{{ member.roleLabel }}</span> <span>{{ member.presence }}</span>
            <UiButton v-for="role in member.roles" :key="role" class="gev-action-button" :data-city-room-set-role="role" @click="controls?.setRole(member.actorId, role)">{{ roleAction(role) }}</UiButton>
          </li>
        </ul>
      </div>
      <p v-if="room.pending" role="status" data-city-room-pending>{{ t('Waiting for {count} earlier changes from other tabs.', { count: room.pending }) }}</p>
      <article v-for="alternative in room.alternatives" :key="alternative.id" :data-city-room-alternative="alternative.id" :data-city-room-conflict="alternative.conflict ? 'true' : 'false'" :style="alternative.conflict ? conflictBox : box">
        <h4>{{ alternative.title }}</h4>
        <p>{{ alternative.createdBy }}</p>
        <p v-if="alternative.branchedFrom" data-city-room-branched>{{ alternative.branchedFrom }}</p>
        <p v-if="alternative.conflict" role="status" data-city-room-conflict-text>{{ alternative.conflictText }}</p>
        <div v-for="version in alternative.heads" :key="version.id" :data-city-room-version="version.id" :style="{ borderTop: '1px solid #2d5260', paddingTop: '6px', marginTop: '6px' }">
          <p data-city-room-credit><strong>{{ version.title }}</strong> <span>{{ version.credit }}</span></p>
          <p>{{ version.description }}</p>
          <p>{{ t('{kind} · trees {trees} · width {width} m · shade {shade}%', { kind: kindLabel(version.parameters.kind), trees: version.parameters.trees, width: version.parameters.widthMeters, shade: version.parameters.shadePercent }) }}</p>
          <p style="color: #d5b67b">{{ t('HYPOTHETICAL · NOT APPROVED') }}</p>
          <ul v-if="version.comments.length" data-city-room-comments>
            <li v-for="note in version.comments" :key="note.id"><strong>{{ note.author }}</strong> <span>{{ note.body }}</span></li>
          </ul>
          <div class="city-room-actions">
            <UiButton class="gev-action-button" data-city-room-inspect :pressed="alternative.inspected" @click="controls?.inspect(alternative.id)">{{ t('Inspect') }}</UiButton>
            <UiButton v-if="version.canKeep" class="gev-action-button" data-city-room-keep @click="controls?.keep(alternative.id, version.id)">{{ t('Keep this revision') }}</UiButton>
            <UiButton class="gev-action-button" data-city-room-edit :disabled="!room.self?.canWrite" @click="controls?.edit(version.id)">{{ t('Edit') }}</UiButton>
            <UiButton class="gev-action-button" data-city-room-branch :disabled="!room.self?.canWrite" @click="controls?.branch(version.id)">{{ t('Branch') }}</UiButton>
          </div>
          <form v-if="room.self?.canWrite" class="city-room-comment" @submit.prevent="sendComment(version.id)">
            <label :for="`city-room-comment-${version.id}`">{{ t('Comment') }}</label>
            <input :id="`city-room-comment-${version.id}`" class="scene-shot-rename city-builder-input" data-city-room-comment-input type="text" maxlength="500" :value="drafts[version.id] ?? ''" @input="drafts[version.id] = $event.target.value">
            <UiButton type="submit" class="gev-action-button" data-city-room-comment-send>{{ t('Send comment') }}</UiButton>
          </form>
        </div>
        <details>
          <summary>{{ t('Revision history') }}</summary>
          <ul>
            <li v-for="version in alternative.versions" :key="version.id"><strong>{{ version.title }}</strong> <span>{{ version.credit }}</span></li>
          </ul>
        </details>
      </article>
      <form v-if="room.self?.canWrite" class="city-builder-alternative-form" data-city-room-editor @submit.prevent="controls?.save()">
        <fieldset>
          <legend>{{ room.editor.mode === 'revise' ? t('Edit revision') : room.editor.mode === 'branch' ? t('Branch into a new proposal') : t('New proposal') }}</legend>
          <label for="city-room-title">{{ t('Alternative title') }}</label>
          <input id="city-room-title" class="scene-shot-rename city-builder-input" type="text" maxlength="160" :value="room.editor.title" @input="controls?.editField('title', $event.target.value)">
          <label for="city-room-description">{{ t('Description') }}</label>
          <textarea id="city-room-description" class="scene-shot-rename city-builder-input" rows="2" maxlength="500" :value="room.editor.description" @input="controls?.editField('description', $event.target.value)"></textarea>
          <label for="city-room-kind">{{ t('Kind') }}</label>
          <UiSelect id="city-room-kind" class="scene-shot-rename city-builder-input" :model-value="room.editor.parameters.kind" @update:model-value="controls?.editField('kind', $event)">
            <option value="park">{{ t('Park') }}</option>
            <option value="bike-lane">{{ t('Bike lane') }}</option>
            <option value="plaza">{{ t('Plaza') }}</option>
          </UiSelect>
          <label for="city-room-trees">{{ t('Trees') }}</label>
          <input id="city-room-trees" class="scene-shot-rename city-builder-input" type="number" min="0" max="200" step="1" :value="room.editor.parameters.trees" @input="controls?.editField('trees', $event.target.value)">
          <label for="city-room-width">{{ t('Width (meters)') }}</label>
          <input id="city-room-width" class="scene-shot-rename city-builder-input" type="number" min="0.5" max="20" step="0.5" :value="room.editor.parameters.widthMeters" @input="controls?.editField('widthMeters', $event.target.value)">
          <label for="city-room-shade">{{ t('Shade (%)') }}</label>
          <input id="city-room-shade" class="scene-shot-rename city-builder-input" type="number" min="0" max="100" step="1" :value="room.editor.parameters.shadePercent" @input="controls?.editField('shadePercent', $event.target.value)">
          <UiButton type="submit" class="gev-action-button" data-city-room-save>{{ t('Share with room') }}</UiButton>
          <UiButton class="gev-action-button" data-city-room-new @click="controls?.newProposal()">{{ t('New proposal') }}</UiButton>
        </fieldset>
      </form>
      <p v-else-if="room.ready && !room.archive" data-city-room-readonly>{{ room.self?.role === 'revoked' ? t('Your contributor access was revoked. You can still read and export the room.') : t('You are a viewer. Ask the owner for contributor access to propose or comment.') }}</p>
      <div v-if="room.rejected.length" :style="box" data-city-room-rejected-list>
        <h4>{{ t('Rejected changes') }}</h4>
        <ul>
          <li v-for="entry in room.rejected" :key="entry.id" :style="rejectedStyle" data-city-room-rejected>{{ entry.text }}</li>
        </ul>
      </div>
    </template>
    <p v-if="room.status" role="status" data-city-room-status>{{ room.status }}</p>
    <p v-if="room.error" role="alert" data-city-room-error>{{ room.error }}</p>
  </section>
</template>
