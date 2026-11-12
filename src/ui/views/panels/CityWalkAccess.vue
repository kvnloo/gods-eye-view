<script setup>
import { t } from '../../../i18n/index.js';

// Display only: rows come from src/ui/cityWalkAccess.js and change nothing.
defineProps({ access: { type: Object, required: true } });
const cell = { padding: '4px 8px', borderBottom: '1px solid #26404b', textAlign: 'start', verticalAlign: 'top' };
</script>

<template>
  <section data-city-access :aria-label="access.title" style="margin: 12px 0; padding: 12px; background: #0b1c26; border: 1px solid #397080; border-radius: 6px">
    <h3 style="margin: 0 0 4px">{{ access.title }}</h3>
    <p data-city-access-label style="margin: 0 0 6px; color: #d5b67b">{{ access.label }}</p>
    <p data-city-access-network style="color: #aad3db">{{ access.network }}</p>
    <p style="color: #aad3db">{{ access.method }}</p>
    <div style="overflow-x: auto">
      <table data-city-access-table style="width: 100%; border-collapse: collapse">
        <thead>
          <tr>
            <th scope="col" :style="cell">{{ t('Possible world') }}</th>
            <th scope="col" :style="cell">{{ t('Site') }}</th>
            <th scope="col" :style="cell">{{ t('Mean walk (range)') }}</th>
            <th scope="col" :style="cell">{{ t('Worst-served walk (range)') }}</th>
            <th scope="col" :style="cell">{{ t('Zones known') }}</th>
            <th scope="col" :style="cell">{{ t('Change from baseline') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in access.rows" :key="row.id" :data-city-access-row="row.id" :data-city-access-state="row.state">
            <th scope="row" :style="cell">{{ row.label }}</th>
            <template v-if="row.state === 'evaluated'">
              <td :style="cell">{{ row.site }}</td>
              <td :style="cell"><strong data-city-access-mean>{{ row.mean }}</strong> ({{ row.meanRange }})</td>
              <td :style="cell"><strong data-city-access-worst>{{ row.worst }}</strong> ({{ row.worstRange }})</td>
              <td :style="cell">{{ row.known }}<template v-if="row.unknown"><br>{{ row.unknown }}</template></td>
              <td :style="cell" data-city-access-delta>{{ row.delta }}</td>
            </template>
            <td v-else colspan="5" :style="cell" data-city-access-note>{{ row.note }}</td>
          </tr>
        </tbody>
      </table>
    </div>
    <p data-city-access-legend>{{ t('Circles are demand zones labelled with metres to the nearest park. Green squares are existing parks; a gold square is the proposed site.') }}</p>
    <div style="display: flex; flex-wrap: wrap; gap: 8px">
      <template v-for="row in access.rows" :key="row.id">
        <figure v-if="row.state === 'evaluated'" :data-city-access-map="row.id" style="flex: 0 1 280px; margin: 0">
          <svg :viewBox="access.map.viewBox" width="100%" role="img" :aria-label="t('Sample network for {option}', { option: row.label })">
            <rect width="100%" height="100%" fill="#0b2630" />
            <line v-for="edge in access.map.edges" :key="edge.id" :x1="edge.x1" :y1="edge.y1" :x2="edge.x2" :y2="edge.y2" stroke="#3d6372" stroke-width="8" stroke-linecap="round" />
            <rect v-for="park in row.parks" :key="park.id" :x="park.x - 16" :y="park.y - 16" width="32" height="32" :fill="park.proposed ? '#d5b67b' : '#65b58b'" stroke="#f0f7f8" stroke-width="2" />
            <g v-for="zone in row.zones" :key="zone.id">
              <circle :cx="zone.x" :cy="zone.y" r="27" fill="#08141e" stroke="#e3faff" stroke-width="2" />
              <text :x="zone.x" :y="zone.y + 8" text-anchor="middle" font-size="22" fill="#e3faff">{{ zone.label }}</text>
            </g>
          </svg>
          <figcaption>{{ row.label }} · {{ row.site }} · {{ row.mean }}</figcaption>
        </figure>
      </template>
    </div>
    <p>{{ access.unchanged }}</p>
  </section>
</template>
