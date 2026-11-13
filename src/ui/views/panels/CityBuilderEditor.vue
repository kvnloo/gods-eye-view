<script setup>
import { t } from '../../../i18n/index.js';
import UiButton from '../../kit/UiButton.vue';
import UiSelect from '../../kit/UiSelect.js';

const props = defineProps({
  city: { type: Object, required: true },
  controls: { type: Object, default: null },
});

const siteName = (id) =>
  props.city.access?.sites.find((site) => site.id === id)?.label ?? t('Not placed on the map');

function importFile(event) {
  const file = event.target.files?.[0];
  event.target.value = '';
  if (file) props.controls?.importFile(file);
}
</script>

<template>
  <section class="city-builder-editor" data-city-builder-editor :aria-label="t('City builder')" :aria-busy="city.pending">
    <h3 v-if="city.projectTitle">{{ city.projectTitle }}</h3>
    <form v-if="!city.reference" class="city-builder-project" @submit.prevent="controls?.start({ title: city.editor.projectTitle })">
      <fieldset :disabled="city.pending">
        <legend>{{ t('Community project') }}</legend>
        <label for="city-builder-project-title">{{ t('Project title') }}</label>
        <input id="city-builder-project-title" class="scene-shot-rename city-builder-input" type="text" maxlength="160" :value="city.editor.projectTitle" @input="controls?.editField('projectTitle', $event.target.value)">
        <UiButton type="submit" class="gev-action-button" data-city-builder-start :disabled="city.pending">{{ t('Start from current view') }}</UiButton>
      </fieldset>
    </form>
    <div class="city-builder-files">
      <label for="city-builder-import">{{ t('Import project') }}</label>
      <input id="city-builder-import" type="file" accept=".json,application/json" :disabled="city.pending" @change="importFile">
      <UiButton class="gev-action-button" data-city-builder-export :disabled="city.pending || !city.reference" @click="controls?.exportFile()">{{ t('Export project') }}</UiButton>
      <p v-if="city.reference" data-city-builder-persistence>{{ city.persisted ? t('Project saved on this device') : t('Project not saved on this device. Export to keep a copy.') }}</p>
    </div>
    <figure v-if="city.reference" class="city-builder-reference" data-city-builder-reference>
      <figcaption>{{ t('Baseline reference from current view') }}</figcaption>
      <img :src="city.reference.image" :alt="t('Captured baseline reference')" style="display: block; max-width: 100%; max-height: 320px; object-fit: contain">
      <time :datetime="city.reference.capturedAt">{{ city.reference.capturedAt }}</time>
    </figure>
    <form v-if="city.reference" class="city-builder-alternative-form" @submit.prevent="controls?.saveAlternative()">
      <fieldset :disabled="city.pending">
        <legend>{{ t('Possible world') }}</legend>
        <label for="city-builder-title">{{ t('Alternative title') }}</label>
        <input id="city-builder-title" class="scene-shot-rename city-builder-input" type="text" maxlength="160" :value="city.editor.title" @input="controls?.editField('title', $event.target.value)">
        <label for="city-builder-description">{{ t('Description') }}</label>
        <textarea id="city-builder-description" class="scene-shot-rename city-builder-input" rows="3" maxlength="500" :value="city.editor.description" @input="controls?.editField('description', $event.target.value)"></textarea>
        <label for="city-builder-kind">{{ t('Kind') }}</label>
        <UiSelect id="city-builder-kind" class="scene-shot-rename city-builder-input" :model-value="city.editor.parameters.kind" :disabled="city.pending" @update:model-value="controls?.editField('kind', $event)">
          <option value="park">{{ t('Park') }}</option>
          <option value="bike-lane">{{ t('Bike lane') }}</option>
          <option value="plaza">{{ t('Plaza') }}</option>
        </UiSelect>
        <label for="city-builder-site">{{ t('Site') }}</label>
        <UiSelect id="city-builder-site" class="scene-shot-rename city-builder-input" :model-value="city.editor.parameters.site ?? ''" :disabled="city.pending" @update:model-value="controls?.editField('site', $event)">
          <option value="">{{ t('Not placed on the map') }}</option>
          <option v-for="site in city.access?.sites ?? []" :key="site.id" :value="site.id">{{ site.label }}</option>
        </UiSelect>
        <label for="city-builder-trees">{{ t('Trees') }}</label>
        <input id="city-builder-trees" class="scene-shot-rename city-builder-input" type="number" min="0" max="200" step="1" :value="city.editor.parameters.trees" @input="controls?.editField('trees', $event.target.value)">
        <label for="city-builder-width">{{ t('Width (meters)') }}</label>
        <input id="city-builder-width" class="scene-shot-rename city-builder-input" type="number" min="0.5" max="20" step="0.5" :value="city.editor.parameters.widthMeters" @input="controls?.editField('widthMeters', $event.target.value)">
        <label for="city-builder-shade">{{ t('Shade (%)') }}</label>
        <input id="city-builder-shade" class="scene-shot-rename city-builder-input" type="number" min="0" max="100" step="1" :value="city.editor.parameters.shadePercent" @input="controls?.editField('shadePercent', $event.target.value)">
        <UiButton type="submit" class="gev-action-button" data-city-builder-save :disabled="city.pending">{{ t('Save possible world') }}</UiButton>
        <UiButton class="gev-action-button" data-city-builder-new :disabled="city.pending" @click="controls?.newAlternative()">{{ t('New alternative') }}</UiButton>
      </fieldset>
    </form>
    <div class="city-builder-provider">
      <label for="city-builder-provider">{{ t('Concept provider') }}</label>
      <UiSelect id="city-builder-provider" class="scene-shot-rename city-builder-input" :model-value="city.provider" :disabled="city.pending" @update:model-value="controls?.setProvider($event)">
        <option value="fixture">{{ t('Fixture') }}</option>
        <option value="local" :disabled="!city.canLocal">{{ t('ChatGPT subscription via local bridge') }}</option>
      </UiSelect>
      <p v-if="city.provider === 'fixture'" data-city-builder-fixture>{{ t('Fixture provider uses a sample image, not a generated view of this site.') }}</p>
      <p v-if="city.provider === 'local'" data-city-builder-remote-notice>{{ t('Imagine sends the captured view, geographic context, and description to ChatGPT. Generation is not on-device.') }}</p>
      <p>{{ t('AI concept, not a plan or an approval') }}</p>
      <p>{{ t('Each version keeps one concept. Save a new version to imagine again.') }}</p>
    </div>
    <ul class="city-builder-versions" :aria-label="t('Alternative versions')">
      <li v-for="alternative in city.alternatives" :key="alternative.id" :data-city-builder-alternative="alternative.id">
        <h3>{{ alternative.title }}</h3>
        <p>{{ t('Version') }} {{ alternative.revision }} · {{ t('Saved versions') }} {{ alternative.versionCount }}</p>
        <UiButton class="gev-action-button" data-city-builder-edit :disabled="city.pending" @click="controls?.editAlternative(alternative.id)">{{ t('Edit') }}</UiButton>
        <UiButton class="gev-action-button" data-city-builder-imagine :disabled="city.pending || Boolean(alternative.concept)" @click="controls?.imagine(alternative.id)">{{ t('Imagine') }}</UiButton>
        <details>
          <summary>{{ t('Version history') }}</summary>
          <ul>
            <li v-for="version in alternative.history" :key="version.revision" :data-city-builder-revision="version.revision">
              <p>{{ t('Version') }} {{ version.revision }} · {{ version.title }}</p>
              <p>{{ version.description }}</p>
              <dl>
                <dt>{{ t('Kind') }}</dt><dd>{{ version.parameters.kind === 'park' ? t('Park') : version.parameters.kind === 'bike-lane' ? t('Bike lane') : t('Plaza') }}</dd>
                <dt>{{ t('Trees') }}</dt><dd>{{ version.parameters.trees }}</dd>
                <dt>{{ t('Width (meters)') }}</dt><dd>{{ version.parameters.widthMeters }}</dd>
                <dt>{{ t('Shade (%)') }}</dt><dd>{{ version.parameters.shadePercent }}</dd>
                <dt>{{ t('Site') }}</dt><dd>{{ siteName(version.parameters.site) }}</dd>
              </dl>
              <UiButton class="gev-action-button" data-city-builder-restore :disabled="city.pending" @click="controls?.restoreRevision(alternative.id, version.revision)">{{ t('Restore as new version') }}</UiButton>
            </li>
          </ul>
        </details>
      </li>
    </ul>
    <p v-if="city.pending" role="status">{{ t('Working…') }}</p>
    <p v-if="city.status" role="status">{{ city.status }}</p>
    <p v-if="city.error" role="alert">{{ city.error }}</p>
  </section>
</template>
