import * as Cesium from 'cesium';
import { watch } from 'vue';
import { plotFromId } from '../data/cityPlot.js';
import { shadowReach, shadowTip, sunPosition } from '../data/citySun.js';
import {
  MASSING_ASSUMPTIONS,
  MAX_STOREYS,
  edgeProbes,
  edgeRing,
  groundBase,
  localFrame,
  plotMassing,
  stepStoreys,
} from '../data/cityMassing.js';
import { massingFacade } from '../data/cityMassingFacade.js';
import {
  ASSUMED_EDGE_METERS,
  edgeDistance,
  inWinter,
  shadowBand,
  shadowFit,
  winterNoon,
} from '../data/cityShadowFit.js';
import {
  holdContinuousRender,
  releaseContinuousRender,
} from '../renderGovernor.js';
import { worldClock } from '../time/worldClock.js';
import { facadeMaterial, facadeUniforms } from './cityMassingLook.js';
import {
  SEAT_TONE,
  groundMaterial,
  medianColour,
  seatShader,
} from './cityMassingSeat.js';

const OWNER = 'city-massing';
// The plate fills the plot from below the ground to just above it: the globe
// never z-fights its top, and a cut photoreal mesh never shows a void.
const PLATE_DEPTH = 0.5;
const PLATE_RISE = 0.1;
// The street is sampled this far outside each plot edge.
const PROBE_METERS = 6;
// Entity geometry builds over several frames and the app renders on demand:
// frames keep coming until the block and plate are drawn as they now stand,
// never longer than this.
const BUILD_MAX_MS = 20000;
// Frames after a change before "drawn" can be trusted: the change reaches the
// entity's geometry batch on the next tick, until then the old one reads drawn.
const BUILD_FRAMES = 2;
// Once the framed tiles load, a ground this much off stands the block anew.
const REGROUND_METERS = 0.5;
// How dark the block's shadow lies on the map while it shows (Cesium's own
// 0.3 is harsher than the shadows already in aerial imagery).
const SHADOW_DARKNESS = 0.4;
// The sun's shadow map spreads its texels over everything out to its
// maximum distance (Cesium: 5 km): seen from 800 m the block's shadow got
// texels metres wide and lay striped on the mesh. While a block shows, the
// map ends this many times the eye's distance to it, never nearer than this.
const SHADOW_BEYOND = 1.6;
const SHADOW_MIN_METERS = 300;
// Screen points this far outside the canvas no longer anchor the readout.
const PAD = 40;
const PLATE = Cesium.Color.fromCssColorString('#8c8a84');
const ACCENT = Cesium.Color.fromCssColorString('#2ec8e8');
// The shadow study on the ground, as thin lines over the shadow the block
// really casts, each where a shadow ends: a solid line for the shadow as it
// now falls, a dashed one for the shadow it is held against (was, or what a
// fit would leave), and the protected edge in amber, reaching past the sides.
const LINE = Cesium.Color.WHITE;
const EDGE = Cesium.Color.fromCssColorString('#ffb454');
const EDGE_PAD_METERS = 6;
// On 3D tiles a ground line smears down every wall it meets, so there a
// study line runs level, this far above the block's base, and shows faintly
// where a building or rising ground stands in front of it.
const LEVEL_RISE = 0.5;
const BEHIND = 0.35;
// On 3D tiles the cut leaves the mesh open along the plot's edge. The mesh is
// sampled this far apart, this far outside the edge, and a blank wall closes
// the cut wherever a neighbour or higher ground stands there.
const SIDE_STEP_METERS = 4;
const SIDE_OUT_METERS = 1;
const SIDES = Cesium.Color.fromCssColorString('#6f6c66');
const MAX_EDGE_METERS = 200;
// SPIKE (exp/city-real-asset-spike, not product): a GLB per storey count may
// stand in for the block. public/city-massing-spike/arm.json names them:
// {"models": {"3": "/city-massing-spike/x.glb"}, "shadows": "ENABLED"}
// (optional "sun", "env", "shade": how it answers the scene sun). The
// GLB is in metres around the footprint's centre, base at 0, Blender's
// export axes (east = +X, up = +Y, north = -Z). No file: the block as it was.
const SPIKE_ARM = '/city-massing-spike/arm.json';
// SPIKE: "seat": {"level": n} seats that GLB on 3D tiles, each level adding to
// the one before (src/standalone/cityMassingSeat.js):
//   1 its shadow is worked out from the block's numbers, soft at the edge,
//     on the tiles, the plate and the closing walls (no shadow map on them),
//     and the study lines over it are half as wide;
//   2 the block hides part of the sky from the ground at its foot;
//   3 the plate and the closing walls take the colour the street showed
//     around the plot before it was cut;
//   4 play mode's selection outline steps aside while the block stands;
//   5 the GLB shadows itself ("shadows": "ENABLED"), with "self":
//     {"normalOffsetScale", "depthBias", "darkness"} on the shadow map;
//   6 the NOW line over the shadow's end goes faint.
// At any level "tone" replaces cityMassingSeat.js SEAT_TONE (the shadow's
// edge width and what it keeps of red and blue) and "steps" squares the
// closing walls, and "cut": m cuts the tiles only m metres outside the block's
// footprint, not along the plot's edge: the neighbours the plot's edge sliced
// stand whole up to the block, and the plate and the closing walls shrink to
// that strip. "keeps" is what the block's shadow keeps of the light (the
// tiles' own shade keeps 0.27 and is bluer: "tone"), and "knee": [dark, lit,
// least] has what the tiles already shade take only that least share of it
// (cityMassingSeat.js).
// SPIKE: "view": {"sun": [east, north, up], "light": [a, s]} is the VIEW look:
// the GLB is lit (a of its colour, s more where it faces that sun) and its
// shadow is cast from the sun the tiles were photographed under, measured from
// the tiles' own shadows (lanes/q15/tools/sun_fit.py). The study keeps its
// own sun: its WAS/NOW lines and every number stay where they were.
// The colours are read this far outside the plot's edge.
// The floor under a plot cut at the footprint: the plot grown this much about
// its centre, this far under its lowest ground, the paving's colour this dark.
const UNDER_GROW = 1.5;
const UNDER_DEPTH = 1;
const UNDER_TONE = 0.3;
const TONE_OUT_METERS = 5;
const TONE_RISE_METERS = 1.5;
const TONE_WALL = 0.8;
const NOW_FAINT = 0.45;
const paved = (c) =>
  Math.max(...c) >= 60 &&
  Math.max(...c) - Math.min(...c) <= 0.12 * Math.max(...c);
const rgb = ({ red, green, blue }) => new Cesium.Cartesian3(red, green, blue);

/**
 * Massing v0 on the globe, mounted only behind ?massing=1: once MASSING is
 * on, the selected play-mode plot gets a ground plate and an assumed block
 * standing on the sampled ground, drawn as a building from its own storeys
 * (src/data/cityMassingFacade.js) and casting its shadow from the scene sun.
 * On 3D tiles the plot is cut out of the mesh so the block never intersects
 * the real building. The readout (CityMassingReadout.vue) shows its numbers and steps
 * its storeys through the play store. PROTECT SIDEWALK adds the shadow study
 * (src/data/cityShadowFit.js): the block's shadow against an edge across the
 * street, drawn on the ground, and FIT TO SUN, which cuts the storeys until the
 * shadow clears it. Nothing is saved: the block is computed from the plot
 * whenever it shows, from the defaults after a reload.
 */
export function mountCityMassing({
  viewer,
  store,
  win = globalThis.window,
  seek = (ms) => worldClock.seek(ms),
}) {
  const scene = viewer?.scene;
  if (!scene || !store) return { destroy() {} };
  const ds = new Cesium.CustomDataSource('gev-city-massing');
  const added = viewer.dataSources.add(ds);
  let storeys = MASSING_ASSUMPTIONS.storeys;
  let on = false;
  let site = null;
  let removeFrame = null;
  let lastAnchors = '';
  // The shadow reach the readout shows, in whole metres.
  let lastReach = null;
  let disposed = false;
  // `{frames, timer, remove}` while frames are held for new geometry.
  let build = null;
  // The shadow study: on or off, the storeys it started from, the protected
  // edge (assumed until the player sets it) and its entities as last drawn.
  let study = false;
  let wasStoreys = storeys;
  let edgeMeters = ASSUMED_EDGE_METERS;
  let edgeSet = false;
  let picking = false;
  let marks = [];
  let marksKey = '0';
  let studyPlot = null;
  const sphere = new Cesium.BoundingSphere();
  let arm = null;
  const spike = { loads: [] };
  // url -> { url, primitive, ready, modelMatrix }: every GLB the arm names
  // loads when the app starts, hidden, so it is ready when its block stands.
  const warm = new Map();
  win
    ?.fetch?.(SPIKE_ARM)
    .then((reply) => reply.json())
    .then((json) => {
      arm = json;
      new Set(Object.values(arm.models ?? {})).forEach(prepare);
      if (site) {
        const { plot } = site;
        hide();
        show(plot);
        publish(plot);
      }
    })
    .catch(() => {});

  function prepare(url) {
    const entry = { url, primitive: null, ready: false, modelMatrix: null };
    warm.set(url, entry);
    const load = { url, startedMs: win.performance.now() };
    spike.loads.push(load);
    const keep = win.setInterval(() => scene.requestRender(), 100);
    Cesium.Model.fromGltfAsync({
      url,
      show: false,
      forwardAxis: Cesium.Axis.X,
      shadows: Cesium.ShadowMode[arm.shadows ?? 'ENABLED'],
      ...(arm.options ?? {}),
    })
      .then((primitive) => {
        if (disposed) return win.clearInterval(keep);
        // The tiles carry their own (high, summer) light and take none from
        // the scene. arm.json may say how the GLB answers the scene sun:
        // "sun" scales its light, "env" its sky light, "shade": [a, s] has
        // it keep a of its colour and add s where it faces the sun, "tilesSun"
        // the same for the sun baked into the tiles.
        if (arm.sun)
          primitive.lightColor = new Cesium.Cartesian3(
            arm.sun,
            arm.sun,
            arm.sun,
          );
        if (arm.env && primitive.environmentMapManager)
          primitive.environmentMapManager.brightness = arm.env;
        const [gain = 0, east = 0, north = 0, up = 1] = arm.tilesSun ?? [];
        if (arm.shade || arm.view)
          primitive.customShader = new Cesium.CustomShader({
            lightingModel: Cesium.LightingModel.UNLIT,
            uniforms: {
              u_viewSun: {
                type: Cesium.UniformType.VEC3,
                value: new Cesium.Cartesian3(),
              },
            },
            fragmentShaderText: `void fragmentMain(FragmentInput fsInput, inout czm_modelMaterial material) {
              vec3 n = normalize(fsInput.attributes.normalEC);
              float d = max(dot(n, czm_lightDirectionEC), 0.0);
              if (dot(u_viewSun, u_viewSun) > 0.0) {
                // VIEW look: lit from the tiles' sun (a world direction), not the scene's.
                d = max(dot(n, normalize(czm_viewRotation * u_viewSun)), 0.0);
                material.diffuse *= ${Number(arm.view?.light?.[0] ?? 0.45).toFixed(3)} + ${Number(arm.view?.light?.[1] ?? 0.7).toFixed(3)} * d;
                return;
              }
              // "tilesSun": [t, east, north, up]: t more where it faces the sun the
              // tiles were photographed under (the GLB's axes: east +X, up +Y, north -Z).
              vec4 tiles = vec4(${[east, up, -north, gain]
                .map((v) => Number(v).toFixed(4))
                .join(', ')});
              float t = tiles.w * max(dot(n, normalize((czm_modelView * vec4(tiles.xyz, 0.0)).xyz)), 0.0);
              material.diffuse *= ${Number(arm.shade?.[0] ?? 1).toFixed(3)} + ${Number(arm.shade?.[1] ?? 0).toFixed(3)} * d + t;
              // "grade": [colour kept, r, g, b, share of that haze]: toward the tiles' tone.
              vec4 grade = vec4(${(arm.grade ?? [1, 0, 0, 0, 0])
                .slice(1)
                .map((v) => Number(v).toFixed(3))
                .join(', ')});
              float grey = dot(material.diffuse, vec3(0.2126, 0.7152, 0.0722));
              material.diffuse = mix(mix(vec3(grey), material.diffuse, ${Number(arm.grade?.[0] ?? 1).toFixed(3)}), grade.rgb, grade.a);
            }`,
          });
        entry.primitive = scene.primitives.add(primitive);
        if (site?.model === entry) place(entry);
        load.fetchedMs = win.performance.now() - load.startedMs;
        primitive.readyEvent.addEventListener(() => {
          win.clearInterval(keep);
          entry.ready = true;
          load.readyMs = win.performance.now() - load.startedMs;
          load.triangles = primitive.statistics?.trianglesLength ?? null;
          load.texturesBytes = primitive.statistics?.texturesByteLength ?? null;
          load.geometryBytes = primitive.statistics?.geometryByteLength ?? null;
          if (site?.model === entry) rendered();
        });
      })
      .catch((error) => {
        win.clearInterval(keep);
        load.error = String(error);
        warm.delete(url);
        if (site?.model === entry) {
          site.model = null;
          site.block.show = true;
          rendered();
        }
      });
  }

  function place({ primitive, modelMatrix, viewSun }) {
    primitive.modelMatrix = modelMatrix;
    primitive.show = true;
    primitive.customShader?.setUniform('u_viewSun', viewSun);
  }

  // SPIKE: the GLB for the standing storeys takes the block's place (the
  // block entity stays, hidden, for its numbers); none: the block shows.
  function stand() {
    const entry = warm.get(arm?.models?.[storeys]) ?? null;
    if (site.model && site.model !== entry && site.model.primitive)
      site.model.primitive.show = false;
    site.model = entry;
    site.block.show = !entry;
    if (!entry) return rendered();
    const { footprint } = site.massing;
    const mean = (k) =>
      footprint.reduce((a, c) => a + c[k], 0) / footprint.length;
    const at = Cesium.Cartesian3.fromDegrees(mean(0), mean(1), site.base);
    // The app's plot metric (111,320 m a degree) against the ellipsoid's.
    const { points } = localFrame(footprint);
    const [a, b] = Cesium.Cartesian3.fromDegreesArray(
      footprint.slice(0, 2).flat(),
    );
    const k =
      Cesium.Cartesian3.distance(a, b) /
      Math.hypot(points[1][0] - points[0][0], points[1][1] - points[0][1]);
    const frame = Cesium.Transforms.eastNorthUpToFixedFrame(at);
    entry.modelMatrix = Cesium.Matrix4.multiplyByScale(
      frame,
      new Cesium.Cartesian3(k, k, 1),
      new Cesium.Matrix4(),
    );
    entry.viewSun = Cesium.Matrix4.multiplyByPointAsVector(
      frame,
      viewSun(),
      new Cesium.Cartesian3(),
    );
    if (entry.primitive) place(entry);
    rendered();
  }

  // SPIKE: the VIEW look's sun as a unit vector east, north, up, or zero.
  const viewSun = () =>
    arm?.view?.sun
      ? Cesium.Cartesian3.normalize(
          new Cesium.Cartesian3(...arm.view.sun),
          new Cesium.Cartesian3(),
        )
      : new Cesium.Cartesian3();

  const playEntities = () =>
    viewer.dataSources.getByName('gev-city-play')[0]?.entities.values ?? [];

  // What the map shows at a point: never our own or play mode's entities.
  function sample([lon, lat]) {
    try {
      const at = Cesium.Cartographic.fromDegrees(lon, lat);
      const height = scene.sampleHeightSupported
        ? scene.sampleHeight(at, [...ds.entities.values, ...playEntities()])
        : undefined;
      if (Number.isFinite(height)) return height;
      return scene.globe?.show ? scene.globe.getHeight(at) : undefined;
    } catch {
      return undefined;
    }
  }

  // The ground for a plot from the centre and the street around it.
  function measure(plot) {
    return groundBase(
      sample([plot.center.lon, plot.center.lat]),
      edgeProbes(plot.corners, PROBE_METERS).map(sample),
    );
  }

  const shownTilesets = () =>
    Array.from({ length: scene.primitives.length }, (_, i) =>
      scene.primitives.get(i),
    ).filter((p) => p instanceof Cesium.Cesium3DTileset && p.show);

  const tilesReady = () =>
    shownTilesets().every((tileset) => tileset.tilesLoaded) &&
    (!scene.globe?.show || scene.globe.tilesLoaded);

  const sceneTime = () =>
    Cesium.JulianDate.toDate(viewer.clock.currentTime).getTime();

  function sunAt(plot) {
    try {
      return sunPosition(plot.center.lat, plot.center.lon, sceneTime());
    } catch {
      return null;
    }
  }

  // SPIKE: the colour the paving shows around the plot before it is cut, read
  // off a frame: the median of the ground-level points TONE_OUT_METERS outside
  // its edge that are paving (near grey and not in deep shade: a back yard's
  // trees are at ground level too and read green). What stands higher there
  // is seen through play mode's selection prism and reads cyan, so the closing
  // walls take the paving's colour too, darker.
  function tones(plot, base) {
    try {
      scene.render(viewer.clock.currentTime);
      const k = scene.drawingBufferWidth / scene.canvas.clientWidth;
      const ground = [];
      for (const { out } of edgeRing(
        plot.corners,
        SIDE_STEP_METERS,
        TONE_OUT_METERS,
      )) {
        const height = sample(out);
        const at =
          Math.abs(height - base) < TONE_RISE_METERS &&
          scene.cartesianToCanvasCoordinates(
            Cesium.Cartesian3.fromDegrees(...out, height),
          );
        if (!at) continue;
        const x = Math.round(at.x * k) - 1;
        const y = scene.drawingBufferHeight - Math.round(at.y * k) - 2;
        if (
          x < 0 ||
          y < 0 ||
          x > scene.drawingBufferWidth - 3 ||
          y > scene.drawingBufferHeight - 3
        )
          continue;
        const px = scene.context.readPixels({ x, y, width: 3, height: 3 });
        const mean = (c) =>
          Math.round(
            Array.from({ length: 9 }, (_, i) => px[4 * i + c]).reduce(
              (a, v) => a + v,
              0,
            ) / 9,
          );
        ground.push([mean(0), mean(1), mean(2)]);
      }
      return { samples: ground, ground: medianColour(ground.filter(paved)) };
    } catch (error) {
      return { error: String(error) };
    }
  }

  // Cut the plot out of every shown 3D tileset (Google photoreal) so the block
  // never intersects the real building; the cut joins any existing clipping.
  // SPIKE: seated, the tiles take the block's shadow from `shader`, not the map.
  function cut(plot, shader) {
    if (!Cesium.ClippingPolygonCollection.isSupported(scene)) return [];
    const positions = Cesium.Cartesian3.fromDegreesArray(plot.corners.flat());
    const cuts = [];
    for (const tileset of shownTilesets()) {
      const created = !tileset.clippingPolygons;
      if (created)
        tileset.clippingPolygons = new Cesium.ClippingPolygonCollection();
      const polygon = tileset.clippingPolygons.add(
        new Cesium.ClippingPolygon({ positions }),
      );
      cuts.push({
        tileset,
        polygon,
        created,
        shadows: tileset.shadows,
        backFaceCulling: tileset.backFaceCulling,
        customShader: tileset.customShader,
      });
      // Photoreal light is baked in: the mesh takes the block's shadow only.
      tileset.shadows = shader
        ? Cesium.ShadowMode.DISABLED
        : Cesium.ShadowMode.RECEIVE_ONLY;
      if (shader) tileset.customShader = shader;
      // The mesh is a hollow shell: where the cut slices a neighbour or the
      // ground above the plate, its inside is drawn, not the sky behind it.
      tileset.backFaceCulling = false;
    }
    return cuts;
  }

  // The walls that close the cut, from the plate's `top` up to the mesh just
  // outside the plot's edge, or null where nothing stands above the plate. A
  // neighbour is wide and a tree or a pole is not: a height counts only when
  // the samples on both sides reach it too.
  function close(plot, top, seated) {
    if (!shownTilesets().length) return null;
    // SPIKE ("seat": {"under": true}): a cut at the footprint slices what
    // stood on the plot into pieces narrower than a neighbour: sampled twice
    // as close.
    const ring = edgeRing(
      plot.corners,
      seated && arm.seat.under ? SIDE_STEP_METERS / 2 : SIDE_STEP_METERS,
      SIDE_OUT_METERS,
    );
    const n = ring.length;
    const beside = (list, pick) =>
      list.map((height, i) =>
        pick(list[(i + n - 1) % n], height, list[(i + 1) % n]),
      );
    const heights = beside(
      beside(
        ring.map(({ out }) => Math.max(top, sample(out) ?? top)),
        Math.min,
      ),
      Math.max,
    );
    if (heights.every((height) => height - top < 0.2)) return null;
    // SPIKE ("seat": {"steps": true}): each stretch stands as high as the
    // taller neighbour at either end, so the walls rise in steps like party
    // walls, not in slopes that leave slivers of the mesh's inside showing.
    const part = (a, b, t) => [
      a[0] + (b[0] - a[0]) * t,
      a[1] + (b[1] - a[1]) * t,
    ];
    const posts =
      seated && arm.seat.steps
        ? ring.flatMap(({ on }, i) => {
            const next = ring[(i + 1) % n].on;
            const height = Math.max(heights[i], heights[(i + 1) % n]);
            return [
              { on: part(on, next, 0.003), height },
              { on: part(on, next, 0.997), height },
            ];
          })
        : ring.map(({ on }, i) => ({ on, height: heights[i] }));
    posts.push(posts[0]);
    return ds.entities.add({
      id: `${OWNER}-sides`,
      wall: {
        positions: Cesium.Cartesian3.fromDegreesArray(
          posts.flatMap(({ on }) => on),
        ),
        minimumHeights: posts.map(() => top),
        maximumHeights: posts.map(({ height }) => Math.max(height, top + 0.05)),
        material: seated ? groundMaterial(() => site?.ground) : SIDES,
        shadows: seated
          ? Cesium.ShadowMode.DISABLED
          : Cesium.ShadowMode.RECEIVE_ONLY,
      },
    });
  }

  function uncut(cuts) {
    for (const { tileset, polygon, created, shadows, ...was } of cuts) {
      if (tileset.isDestroyed()) continue;
      tileset.clippingPolygons?.remove(polygon);
      if (created && tileset.clippingPolygons?.length === 0)
        tileset.clippingPolygons = undefined;
      tileset.shadows = shadows;
      tileset.backFaceCulling = was.backFaceCulling;
      tileset.customShader = was.customShader;
    }
  }

  // Whether the plate and block are drawn (their geometry has built).
  function drawn() {
    const display = viewer.dataSourceDisplay;
    if (typeof display?.getBoundingSphere !== 'function') return true;
    try {
      if (site?.model && !site.model.ready) return false;
      return [site?.plate, !site?.model && site?.block, ...marks]
        .filter(Boolean)
        .every(
          (entity) =>
            display.getBoundingSphere(entity, false, sphere) ===
            Cesium.BoundingSphereState.DONE,
        );
    } catch {
      return false;
    }
  }

  // Keep frames coming until the changed geometry is drawn: the cast shadow
  // and the block show together, not on the next camera move.
  function rendered() {
    if (!build) {
      holdContinuousRender(OWNER);
      build = { frames: 0, timer: 0, remove: null };
      build.remove = scene.postRender.addEventListener(() => {
        if (++build.frames > BUILD_FRAMES && drawn()) built();
      });
    }
    build.frames = 0;
    clearTimeout(build.timer);
    build.timer = setTimeout(built, BUILD_MAX_MS);
    scene.requestRender();
  }

  // Metres along the shadow, read off the drawn entities: how far each line
  // lies from the face the shadow leaves.
  function drawnMeters() {
    // A line's middle on the ellipsoid, whatever height it runs at.
    const middle = (line) =>
      Cesium.Cartesian3.midpoint(
        ...[line[0], line.at(-1)].map((at) =>
          Cesium.Ellipsoid.WGS84.scaleToGeodeticSurface(
            at,
            new Cesium.Cartesian3(),
          ),
        ),
        new Cesium.Cartesian3(),
      );
    const face = middle(
      Cesium.Cartesian3.fromDegreesArray(
        shadowBand(site.massing.footprint, site.sun, 0).slice(0, 2).flat(),
      ),
    );
    return Object.fromEntries(
      marks.map((entity) => [
        entity.id.slice(`${OWNER}-shadow-`.length),
        Cesium.Cartesian3.distance(
          face,
          middle(entity.polyline.positions.getValue()),
        ),
      ]),
    );
  }

  function built() {
    if (!build) return;
    build.remove();
    clearTimeout(build.timer);
    build = null;
    releaseContinuousRender(OWNER);
  }

  function hide() {
    if (!site) return;
    removeFrame?.();
    removeFrame = null;
    lastAnchors = '';
    store.placeMassing(null);
    if (site.model?.primitive) site.model.primitive.show = false;
    site.seat?.stop();
    ds.entities.removeAll();
    marks = [];
    marksKey = '0';
    uncut(site.cuts);
    viewer.shadows = site.shadowsBefore;
    if (scene.globe) scene.globe.shadows = site.globeShadows;
    if (scene.shadowMap) {
      scene.shadowMap.softShadows = site.softShadows;
      scene.shadowMap.darkness = site.darkness;
      scene.shadowMap.maximumDistance = site.maximumDistance;
    }
    site = null;
    rendered();
  }

  function show(plot) {
    if (site?.plot.id === plot.id) return;
    hide();
    const ground = measure(plot);
    const base = ground?.base ?? 0;
    const massing = plotMassing({ corners: plot.corners, storeys });
    const sun = sunAt(plot);
    const shadowsBefore = viewer.shadows;
    const globeShadows = scene.globe?.shadows;
    const softShadows = scene.shadowMap?.softShadows;
    const darkness = scene.shadowMap?.darkness;
    const maximumDistance = scene.shadowMap?.maximumDistance;
    // SPIKE: seated only on 3D tiles, under a block the arm gives a GLB.
    const level =
      massing.footprint && shownTilesets().length ? (arm?.seat?.level ?? 0) : 0;
    const seat = level > 0 ? seatShader() : null;
    // What is cut out of the tiles, plated and closed: the plot, or (SPIKE)
    // the footprint and a margin.
    const hole =
      seat && arm.seat.cut >= 0
        ? {
            corners: plotMassing({
              corners: plot.corners,
              storeys,
              setbackMeters: Math.max(0, massing.setbackMeters - arm.seat.cut),
            }).footprint,
          }
        : plot;
    if (seat) {
      seat.level = level;
      seat.tones = level >= 3 ? tones(plot, base) : {};
      const bias = scene.shadowMap._primitiveBias;
      const was = { ...bias };
      if (level >= 5) Object.assign(bias, arm.seat.self ?? {});
      // Each frame, before it is drawn: where the block is from the eye.
      const remove = scene.preRender.addEventListener(() => {
        if (!site?.look) return;
        site.ground.gevSeatOn.x = viewer.shadows ? 1 : 0;
        seat.place(
          site.ground,
          Cesium.Matrix4.multiplyByPoint(
            viewer.camera.viewMatrix,
            site.origin,
            new Cesium.Cartesian3(),
          ),
        );
      });
      seat.stop = () => {
        remove();
        Object.assign(bias, was);
      };
    }
    // A cast shadow needs the sun above the horizon. The globe receives it,
    // with soft (filtered) edges and no darker than a shadow in the imagery,
    // so the band reads as a shadow on the ground.
    viewer.shadows = shadowsBefore || sun?.elevationDeg > 0;
    if (scene.globe) scene.globe.shadows = Cesium.ShadowMode.RECEIVE_ONLY;
    if (scene.shadowMap) {
      scene.shadowMap.softShadows = true;
      scene.shadowMap.darkness =
        (level >= 5 && arm.seat.self?.darkness) || SHADOW_DARKNESS;
    }
    site = {
      seat,
      plot,
      base,
      sampled: ground !== null,
      massing,
      sun,
      shadowsBefore,
      globeShadows,
      softShadows,
      darkness,
      maximumDistance,
      // The surface this block was cut into and stood on, checked each frame.
      tilesets: shownTilesets(),
      globe: Boolean(scene.globe?.show),
      ready: false,
      hole,
      // SPIKE ("under"): the tiles are a shell with no ground under a building. Cut at
      // the footprint, what stood on the plot is open toward the block: a
      // dark floor under the plot and around it shows there, not the void.
      under:
        hole !== plot &&
        arm.seat.under &&
        ds.entities.add({
          id: `${OWNER}-under`,
          polygon: {
            hierarchy: Cesium.Cartesian3.fromDegreesArray(
              plot.corners.flatMap(([lon, lat]) => [
                plot.center.lon + (lon - plot.center.lon) * UNDER_GROW,
                plot.center.lat + (lat - plot.center.lat) * UNDER_GROW,
              ]),
            ),
            height: (ground?.floor ?? base) - UNDER_DEPTH,
            material: Cesium.Color.multiplyByScalar(
              seat.tones.ground
                ? new Cesium.Color(
                    seat.tones.ground.x,
                    seat.tones.ground.y,
                    seat.tones.ground.z,
                  )
                : SIDES,
              UNDER_TONE,
              new Cesium.Color(),
            ).withAlpha(1),
            shadows: Cesium.ShadowMode.DISABLED,
          },
        }),
      sides: close(hole, base + PLATE_RISE, seat),
      cuts: cut(hole, seat?.shader),
      plate: ds.entities.add({
        id: `${OWNER}-plate`,
        polygon: {
          hierarchy: Cesium.Cartesian3.fromDegreesArray(hole.corners.flat()),
          height: (ground?.floor ?? base) - PLATE_DEPTH,
          extrudedHeight: base + PLATE_RISE,
          // Paving around a block (the same material knows the ground).
          material: seat
            ? groundMaterial(() => site?.ground)
            : massing.footprint
              ? facadeMaterial(() => site?.look)
              : PLATE,
          shadows: seat
            ? Cesium.ShadowMode.DISABLED
            : Cesium.ShadowMode.RECEIVE_ONLY,
        },
      }),
      block:
        massing.footprint &&
        ds.entities.add({
          id: `${OWNER}-block`,
          polygon: {
            hierarchy: Cesium.Cartesian3.fromDegreesArray(
              massing.footprint.flat(),
            ),
            height: base,
            extrudedHeight: base + massing.heightMeters,
            material: facadeMaterial(() => site?.look),
            // The block casts and receives nothing: its own shader shades
            // it, and a shadow map speckles a lit roof it falls back on.
            shadows: Cesium.ShadowMode.CAST_ONLY,
          },
        }),
    };
    dress();
    if (site.block) stand();
    removeFrame = scene.postRender.addEventListener(frame);
    mark();
    rendered();
  }

  // The building the block is drawn as, and what its shader reads, as the
  // block now stands: its storeys and its ground.
  function dress() {
    site.facade = massingFacade(site.massing);
    site.look = site.facade && facadeUniforms(site.facade, site.base);
    if (!site.seat) return;
    site.origin = Cesium.Cartesian3.fromDegrees(
      ...site.facade.origin,
      site.base,
    );
    const { ground } = site.seat.tones;
    site.ground = {
      ...site.look,
      gevGround: ground ?? rgb(PLATE),
      gevSides: ground
        ? Cesium.Cartesian3.multiplyByScalar(ground, TONE_WALL, ground.clone())
        : rgb(SIDES),
      // The sun's shadow shows, the sky's share of the light, the sky hidden.
      gevSeatOn: new Cesium.Cartesian3(
        1,
        arm.seat.keeps ?? SHADOW_DARKNESS,
        site.seat.level >= 2 ? 1 : 0,
      ),
      gevSeatKnee: new Cesium.Cartesian3(...(arm.seat.knee ?? [0, 0, 0])),
      gevSeatTone: arm.seat.tone
        ? new Cesium.Cartesian4(...arm.seat.tone)
        : SEAT_TONE,
      gevViewSun: viewSun(),
    };
  }

  // The study of the standing block against the edge, or null while it is off.
  function plan() {
    return study && site
      ? shadowFit({
          storeys,
          wasStoreys,
          storeyHeightMeters: site.massing.storeyHeightMeters,
          sun: site.sun,
          edgeMeters,
        })
      : null;
  }

  // Draw the study on the ground when it changed: the protected edge, where
  // the shadow now ends (solid) and where the one it is held against does
  // (dashed).
  function mark() {
    const lines = site?.block ? (plan()?.lines ?? []) : [];
    const band = (meters) =>
      shadowBand(site.massing.footprint, site.sun, meters);
    // To 0.1 m: a live clock moves the sun a little every frame.
    const key = JSON.stringify(
      lines.length && [
        lines.map((line) => [line.kind, line.reachMeters.toFixed(1)]),
        band(edgeMeters)
          .flat()
          .map((degrees) => degrees.toFixed(6)),
      ],
    );
    if (key === marksKey) return;
    marksKey = key;
    marks.forEach((entity) => ds.entities.remove(entity));
    const add = (id, graphics) =>
      ds.entities.add({ id: `${OWNER}-shadow-${id}`, ...graphics });
    // One line across where a shadow ends: on the ground, or level on tiles.
    const level = site.cuts.length > 0;
    const stroke = (color, dashed) =>
      dashed
        ? new Cesium.PolylineDashMaterialProperty({ color, dashLength: 14 })
        : new Cesium.ColorMaterialProperty(color);
    const thin = site.seat ? 0.5 : 1;
    const line = (id, ends, color, dashed, width = 3) =>
      add(id, {
        polyline: level
          ? {
              positions: Cesium.Cartesian3.fromDegreesArrayHeights(
                ends.flatMap((end) => [...end, site.base + LEVEL_RISE]),
              ),
              width: width * thin,
              material: stroke(color, dashed),
              depthFailMaterial: stroke(color.withAlpha(BEHIND), dashed),
            }
          : {
              positions: Cesium.Cartesian3.fromDegreesArray(ends.flat()),
              width,
              clampToGround: true,
              material: stroke(color, dashed),
            },
      });
    const faint = site.seat?.level >= 6 ? NOW_FAINT : 1;
    marks = lines.map(({ kind, reachMeters }) =>
      line(
        kind,
        band(reachMeters).slice(2),
        kind === 'now' ? LINE.withAlpha(faint) : kind === 'was' ? LINE : ACCENT,
        kind !== 'now',
      ),
    );
    if (lines.length)
      marks.push(
        line(
          'edge',
          shadowBand(
            site.massing.footprint,
            site.sun,
            edgeMeters,
            EDGE_PAD_METERS,
          ).slice(2),
          EDGE,
          false,
          4,
        ),
      );
    rendered();
  }
  // Tiles refine after a zoom or a flight: re-measure the ground once they have
  // loaded, as play mode re-grounds a restored concept (src/standalone/cityPlay.js).
  function reground() {
    const ground = measure(site.plot);
    if (!ground) return;
    if (site.sampled && Math.abs(ground.base - site.base) < REGROUND_METERS)
      return;
    site.base = ground.base;
    site.sampled = true;
    marksKey = '0';
    site.plate.polygon.height = ground.floor - PLATE_DEPTH;
    if (site.under) site.under.polygon.height = ground.floor - UNDER_DEPTH;
    site.plate.polygon.extrudedHeight = ground.base + PLATE_RISE;
    if (site.sides) ds.entities.remove(site.sides);
    site.sides = close(site.hole, ground.base + PLATE_RISE, site.seat);
    if (site.block) {
      site.block.polygon.height = ground.base;
      site.block.polygon.extrudedHeight =
        ground.base + site.massing.heightMeters;
    }
    dress();
    if (site.block) stand();
    rendered();
  }

  // The stepper re-extrudes the standing block from the new storey count.
  function extrude() {
    site.massing = plotMassing({ corners: site.plot.corners, storeys });
    site.block.polygon.extrudedHeight = site.base + site.massing.heightMeters;
    dress();
    stand();
    mark();
    rendered();
  }

  function project(lon, lat, height) {
    const world = Cesium.Cartesian3.fromDegrees(lon, lat, height);
    const camera = viewer.camera;
    const toPoint = Cesium.Cartesian3.subtract(
      world,
      camera.positionWC,
      new Cesium.Cartesian3(),
    );
    if (Cesium.Cartesian3.dot(toPoint, camera.directionWC) <= 0) return null;
    const p = scene.cartesianToCanvasCoordinates(world);
    if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) return null;
    const rect = scene.canvas.getBoundingClientRect();
    if (
      p.x < -PAD ||
      p.y < -PAD ||
      p.x > rect.width + PAD ||
      p.y > rect.height + PAD
    )
      return null;
    return { x: Math.round(p.x + rect.left), y: Math.round(p.y + rect.top) };
  }

  // Each frame: follow the surface (a map switch re-cuts and re-grounds, loaded
  // tiles re-ground), the scene sun, and the block and its shadow tip on
  // screen, so the readout never covers them.
  function frame() {
    if (!site?.block) return;
    const tilesets = shownTilesets();
    if (
      tilesets.length !== site.tilesets.length ||
      tilesets.some((t, i) => t !== site.tilesets[i]) ||
      Boolean(scene.globe?.show) !== site.globe
    ) {
      const plot = site.plot;
      queueMicrotask(() => {
        if (disposed || site?.plot !== plot) return;
        hide();
        show(plot);
      });
      return;
    }
    const ready = tilesReady();
    if (ready && !site.ready) reground();
    site.ready = ready;
    site.sun = sunAt(site.plot);
    // The sun moves with the scene clock: the readout follows its reach.
    const reach = shadowReach(site.massing.heightMeters, site.sun);
    if ((reach === null ? null : Math.round(reach)) !== lastReach)
      publish(site.plot);
    mark();
    const shadows = site.shadowsBefore || site.sun?.elevationDeg > 0;
    if (viewer.shadows !== shadows) viewer.shadows = shadows;
    if (scene.shadowMap)
      scene.shadowMap.maximumDistance = Math.min(
        site.maximumDistance ?? Infinity,
        Math.max(
          SHADOW_MIN_METERS,
          SHADOW_BEYOND *
            Cesium.Cartesian3.distance(
              viewer.camera.positionWC,
              Cesium.Cartesian3.fromDegrees(
                site.plot.center.lon,
                site.plot.center.lat,
                site.base,
              ),
            ),
        ),
      );
    const { base, massing } = site;
    const top = base + massing.heightMeters;
    const tip = shadowTip(massing.footprint, massing.heightMeters, site.sun);
    // The study's bands on screen: the readout keeps clear of them too, and
    // each tip label points at the far side of its line.
    const bands = (marks.length ? plan().lines : []).map((line) => [
      line.kind,
      shadowBand(massing.footprint, site.sun, line.reachMeters).map(
        ([lon, lat]) => project(lon, lat, base),
      ),
    ]);
    const points = [
      ...massing.footprint.map(([lon, lat]) => project(lon, lat, base)),
      ...massing.footprint.map(([lon, lat]) => project(lon, lat, top)),
      ...(tip ?? []).map(([lon, lat]) => project(lon, lat, base)),
      ...bands.flatMap(([, band]) => band),
    ].filter(Boolean);
    const tips = Object.fromEntries(
      bands.map(([kind, band]) => [kind, band.slice(2)]),
    );
    const key = JSON.stringify([points, tips]);
    if (key === lastAnchors) return;
    lastAnchors = key;
    store.placeMassing({ points, tips });
  }

  // Play mode's selected plot; Reimagine captures the plot as it is.
  function selected() {
    const view = store.view;
    return view?.active && !view.pending && view.tier !== 'district'
      ? plotFromId(view.plot?.id)
      : null;
  }

  function publish(plot) {
    if (!plot) return store.publishMassing(null);
    const standing = site?.plot.id === plot.id;
    const m = standing
      ? site.massing
      : plotMassing({ corners: plot.corners, storeys });
    const sun = standing ? site.sun : sunAt(plot);
    const reach = shadowReach(m.heightMeters, sun);
    lastReach = reach === null ? null : Math.round(reach);
    store.publishMassing({
      on,
      // SPIKE: play mode's selection outline steps aside for a seated block.
      quiet: on && arm?.seat?.level >= 4,
      plotId: plot.id,
      storeys,
      maxStoreys: MAX_STOREYS,
      storeyHeightMeters: m.storeyHeightMeters,
      setbackMeters: m.setbackMeters,
      heightMeters: m.heightMeters,
      far: m.far,
      floorAreaSquareMeters: m.floorAreaSquareMeters,
      homes: m.homes,
      residentialShare: m.residentialShare,
      homeSquareMeters: m.homeSquareMeters,
      shadowReachMeters: reach,
      sunElevationDeg: sun?.elevationDeg ?? null,
      // The shadow study: its toggle, the protected edge and, while it is on
      // and the block stands, the plan that the ground and the tips show.
      shadow: {
        on: study,
        picking,
        edgeMeters,
        edgeSet,
        winter: inWinter(plot.center.lat, sceneTime()),
        plan: standing ? plan() : null,
        // What the storeys the study started from held, once they changed.
        was: study && wasStoreys !== storeys ? wasMassing(plot) : null,
      },
    });
  }

  function sync() {
    if (disposed) return;
    const plot = selected();
    // A study belongs to its plot: another plot starts from the assumption.
    if ((plot?.id ?? null) !== studyPlot) {
      studyPlot = plot?.id ?? null;
      wasStoreys = storeys;
      edgeMeters = ASSUMED_EDGE_METERS;
      edgeSet = false;
      picking = false;
    }
    if (plot && on) show(plot);
    else hide();
    publish(plot);
  }

  function wasMassing(plot) {
    const { homes, far } = plotMassing({
      corners: plot.corners,
      storeys: wasStoreys,
    });
    return { homes, far };
  }

  // A study control changed something: redraw the ground and the readout.
  function restudy() {
    if (site) mark();
    lastAnchors = '';
    publish(selected());
    scene.requestRender();
  }

  function setEdge(meters) {
    edgeMeters = Math.min(MAX_EDGE_METERS, Math.max(1, Math.round(meters)));
    edgeSet = true;
    restudy();
  }
  const stop = watch(() => store.view, sync);

  const controls = {
    toggle() {
      on = !on;
      sync();
    },
    step(delta) {
      const next = stepStoreys(storeys, delta);
      if (next === storeys) return;
      storeys = next;
      if (site?.block) extrude();
      publish(selected());
    },
    // The shadow study starts from the storeys that stand when it turns on.
    study() {
      study = !study;
      wasStoreys = storeys;
      picking = false;
      restudy();
    },
    stepEdge(delta) {
      setEdge(edgeMeters + delta);
    },
    // SET ON MAP arms one ground click, which play mode hands over to click().
    pickEdge() {
      picking = !picking;
      restudy();
    },
    click(point) {
      if (!picking || !point || !site?.block || !(site.sun?.elevationDeg > 0))
        return false;
      const meters = edgeDistance(site.massing.footprint, site.sun, [
        point.lon,
        point.lat,
      ]);
      // A click on the block or behind the face the shadow leaves sets
      // nothing: the tool stays armed for the next one.
      if (meters < 1) return true;
      picking = false;
      setEdge(meters);
      return true;
    },
    // The scene clock goes to solar noon on the winter solstice at the plot.
    winterNoon() {
      const plot = selected();
      if (!plot) return;
      seek(winterNoon(plot.center.lat, plot.center.lon, sceneTime()));
      rendered();
    },
    // Cut the storeys to the most that still clear the edge.
    fit() {
      const next = plan();
      if (!next?.canFit || !site?.block) return;
      storeys = next.fit.storeys;
      extrude();
      restudy();
    },
  };
  store.connectMassing(controls);

  const probe = Object.freeze({
    snapshot: () =>
      Object.freeze({
        on,
        shown: Boolean(site?.block),
        plotId: site?.plot.id ?? null,
        storeys,
        massing: site?.massing ?? null,
        base: site?.base ?? null,
        sampled: site?.sampled ?? false,
        blockTop: site ? site.base + site.massing.heightMeters : null,
        // The entities themselves, so a journey checks what is drawn.
        blockBase: site?.block?.polygon.height.getValue() ?? null,
        blockExtrudedHeight:
          site?.block?.polygon.extrudedHeight.getValue() ?? null,
        plateTop: site?.plate.polygon.extrudedHeight.getValue() ?? null,
        plateBottom: site?.plate.polygon.height.getValue() ?? null,
        shadowMap: viewer.shadows,
        blockShadows:
          site?.block?.polygon.shadows.getValue() ===
          Cesium.ShadowMode.CAST_ONLY,
        // The plate and block as they now stand are on screen.
        drawn: Boolean(site?.block) && !build && drawn(),
        sun: site?.sun ?? null,
        cuts: site?.cuts.length ?? 0,
        // The building the block is drawn as, and its material on the entity.
        facade: site?.facade ?? null,
        blockMaterial: site?.block?.polygon.material.type ?? null,
        spike: {
          arm,
          model: site?.model?.url ?? null,
          loads: spike.loads,
          seat: site?.seat
            ? {
                level: site.seat.level,
                tones: site.seat.tones,
                tileShadows: site.cuts.map(({ tileset }) => tileset.shadows),
              }
            : null,
        },
        // The shadow study: its plan, and the lines as the entities hold them.
        study: study && {
          wasStoreys,
          edgeMeters,
          edgeSet,
          picking,
          plan: plan(),
          drawn: marks.length > 0 && drawnMeters(),
        },
      }),
  });
  if (win) win.__gevCityMassing = probe;
  sync();

  return {
    destroy() {
      if (disposed) return;
      disposed = true;
      stop();
      hide();
      warm.forEach(
        ({ primitive }) => primitive && scene.primitives.remove(primitive),
      );
      built();
      if (win?.__gevCityMassing === probe) delete win.__gevCityMassing;
      if (store.massingControls === controls) {
        store.connectMassing(null);
        store.publishMassing(null);
        store.placeMassing(null);
      }
      Promise.resolve(added).then(() => viewer.dataSources?.remove(ds, true));
    },
  };
}
