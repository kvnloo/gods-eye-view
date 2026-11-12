import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { checkCatalog, unmarkedScript } from './i18n.mjs';

const root = new URL('../', import.meta.url);
const sources = [
  'src/ui/cityBuilder.js',
  'src/ui/communityPlanningPreview.js',
  'src/ui/views/panels/CityBuilderEditor.vue',
  'src/ui/views/panels/CommunityPlanningPreview.vue',
  'src/ui/views/panels/GlobeActions.vue',
];
const string = String.raw`'(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*"|\`(?:\\.|[^\`\\$])*\``;
const call = new RegExp(
  String.raw`\bt\(\s*(${string})\s*,\s*\{\s*context:\s*(${string})|\b(?:t|msg)\(\s*(${string})|\btn\(\s*[^,]+?,\s*(${string})\s*,\s*(${string})`,
  'g',
);
const unquote = (literal) =>
  literal
    .slice(1, -1)
    .replace(
      /\\(u\{[0-9a-fA-F]+\}|u[0-9a-fA-F]{4}|x[0-9a-fA-F]{2}|.)/gs,
      (_, escaped) =>
        /^[ux]/.test(escaped)
          ? String.fromCodePoint(parseInt(escaped.replace(/[ux{}]/g, ''), 16))
          : ({ n: '\n', t: '\t', r: '\r' }[escaped] ?? escaped),
    );

// Read explicit paths, including files not yet in Git's index.
export function checkCityBuilderLocales() {
  const messages = new Map();
  const problems = [];
  for (const file of sources) {
    const source = readFileSync(new URL(file, root), 'utf8');
    for (const match of source.matchAll(call)) {
      const key = match[1]
        ? `${unquote(match[2])}|${unquote(match[1])}`
        : unquote(match[3] ?? match[5]);
      messages.set(key, {
        plural: Boolean(match[5]),
        one: match[4] && unquote(match[4]),
        where: file,
      });
    }
    for (const { where, text } of unmarkedScript(file, source))
      problems.push(`${where}: unmarked ${text}`);
  }
  const directory = new URL('src/i18n/locales/', root);
  const locales = readdirSync(directory)
    .filter((file) => file.endsWith('.json'))
    .sort();
  for (const file of locales) {
    const locale = file.slice(0, -5);
    const catalog = JSON.parse(readFileSync(new URL(file, directory), 'utf8'));
    const { missing, errors } = checkCatalog(locale, catalog, messages);
    problems.push(...missing.map((key) => `${locale}: missing ${key}`));
    problems.push(...errors.map((error) => `${locale}: ${error}`));
  }
  return { messages, locales, problems };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { messages, locales, problems } = checkCityBuilderLocales();
  if (problems.length) {
    console.error(problems.join('\n'));
    process.exitCode = 1;
  } else {
    console.log(
      `City builder: ${messages.size} messages complete in ${locales.length} locales; no unmarked status/error literals.`,
    );
  }
}
