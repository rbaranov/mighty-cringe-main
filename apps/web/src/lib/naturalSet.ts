import type { CurrentUser, Exercise, UnitSystem } from '@mighty-cringe/contracts';

import { canonicalWeight } from './preferences';

export type NaturalSetDraft = {
  weightKg: number;
  reps: number;
  rir: number | null;
  comment: string | null;
};

export type NaturalSetResult =
  | {
      status: 'ready';
      exercise: Exercise;
      draft: NaturalSetDraft;
    }
  | {
      status: 'needs_clarification';
      question: string;
      candidates: Exercise[];
    };

const numberWords: Record<string, number> = {
  ноль: 0,
  нуль: 0,
  один: 1,
  одна: 1,
  одно: 1,
  два: 2,
  две: 2,
  три: 3,
  четыре: 4,
  пять: 5,
  шесть: 6,
  семь: 7,
  восемь: 8,
  девять: 9,
  десять: 10,
  одиннадцать: 11,
  двенадцать: 12,
  тринадцать: 13,
  четырнадцать: 14,
  пятнадцать: 15,
  шестнадцать: 16,
  семнадцать: 17,
  восемнадцать: 18,
  девятнадцать: 19,
  двадцать: 20,
  тридцать: 30,
  сорок: 40,
  пятьдесят: 50,
  шестьдесят: 60,
  семьдесят: 70,
  восемьдесят: 80,
  девяносто: 90,
  сто: 100,
  двести: 200,
  триста: 300,
  четыреста: 400,
  пятьсот: 500,
  шестьсот: 600,
  семьсот: 700,
  восемьсот: 800,
  девятьсот: 900,
};

const weightUnits = new Set([
  'кг',
  'килограмм',
  'килограмма',
  'килограммов',
  'kg',
  'kgs',
  'lb',
  'lbs',
  'pound',
  'pounds',
]);
const imperialWeightUnits = new Set(['lb', 'lbs', 'pound', 'pounds']);
const volumeSeparators = new Set(['на', 'x', 'for']);

export function parseNaturalSet({
  text,
  catalog,
  scopedExercise = null,
  exerciseOverride = null,
  locale = 'ru',
  unitSystem = 'metric',
}: {
  text: string;
  catalog: Exercise[];
  scopedExercise?: Exercise | null;
  exerciseOverride?: Exercise | null;
  locale?: CurrentUser['locale'];
  unitSystem?: UnitSystem;
}): NaturalSetResult {
  const normalized = normalize(text);
  if (!normalized) {
    return clarification(
      tr(
        locale,
        'Напиши подход, например: «жим лёжа 80 на 8, RIR 2».',
        'Describe a set, for example: “bench press 175 for 8, RIR 2”.',
      ),
    );
  }

  const exerciseMatch = exerciseOverride
    ? { exercise: exerciseOverride, matchedPhrase: '' }
    : matchExercise(normalized, catalog);
  if (exerciseMatch && 'candidates' in exerciseMatch) {
    return {
      status: 'needs_clarification',
      question: tr(
        locale,
        'Какое именно упражнение ты имеешь в виду?',
        'Which exercise do you mean?',
      ),
      candidates: exerciseMatch.candidates,
    };
  }
  const exercise = exerciseMatch?.exercise ?? scopedExercise;
  if (!exercise) {
    return clarification(
      tr(
        locale,
        'Какое упражнение записать? Добавь название или его псевдоним.',
        'Which exercise should be logged? Add its name or alias.',
      ),
    );
  }

  const volume = findVolume(normalized, unitSystem);
  if (!volume) {
    return clarification(
      tr(
        locale,
        'Уточни вес и повторы, например: «40 на 12».',
        'Add weight and reps, for example: “90 for 12”.',
      ),
    );
  }
  if (volume.weightKg < 0 || volume.weightKg > 1000) {
    return clarification(
      tr(
        locale,
        'Вес должен быть от 0 до 1000 кг. Уточни вес подхода.',
        'Weight must be between 0 and 1,000 kg. Check the set weight.',
      ),
    );
  }
  if (!Number.isInteger(volume.reps) || volume.reps < 1 || volume.reps > 100) {
    return clarification(
      tr(
        locale,
        'Повторы должны быть целым числом от 1 до 100. Уточни количество.',
        'Reps must be a whole number from 1 to 100.',
      ),
    );
  }

  const rirMatch = findRir(normalized);
  if (rirMatch && (rirMatch.value < 0 || rirMatch.value > 20)) {
    return clarification(
      tr(
        locale,
        'RIR должен быть от 0 до 20. Уточни запас повторов.',
        'RIR must be between 0 and 20.',
      ),
    );
  }

  const comment = extractComment(text, normalized, [
    volume.matchedPhrase,
    rirMatch?.matchedPhrase ?? '',
    exerciseMatch?.matchedPhrase ?? '',
  ]);
  return {
    status: 'ready',
    exercise,
    draft: {
      weightKg: volume.weightKg,
      reps: volume.reps,
      rir: rirMatch?.value ?? null,
      comment,
    },
  };
}

function matchExercise(normalized: string, catalog: Exercise[]) {
  const matches = catalog.flatMap((exercise) => {
    const variants = [exercise.nameRu, exercise.nameEn, ...exercise.aliases]
      .map(normalize)
      .filter(Boolean);
    const matchedPhrase = variants
      .flatMap((variant) => {
        const matched = findMatchedPhrase(normalized, variant);
        return matched ? [matched] : [];
      })
      .sort((left, right) => right.length - left.length)[0];
    return matchedPhrase ? [{ exercise, matchedPhrase, score: matchedPhrase.length }] : [];
  });
  if (!matches.length) return null;
  const topScore = Math.max(...matches.map((match) => match.score));
  const top = matches.filter((match) => match.score === topScore);
  if (top.length > 1) return { candidates: top.map((match) => match.exercise) };
  return { exercise: top[0].exercise, matchedPhrase: top[0].matchedPhrase };
}

function findVolume(normalized: string, unitSystem: UnitSystem) {
  const direct = normalized.match(
    /(?:^|\s)(\d+(?:\.\d+)?)\s*(кг|килограмм(?:а|ов)?|kg|kgs|lb|lbs|pound|pounds)?\s*(?:на|x|for)\s*(\d+)(?:\s|$)/,
  );
  if (direct) {
    const inputUnitSystem = direct[2]
      ? imperialWeightUnits.has(direct[2])
        ? 'imperial'
        : 'metric'
      : unitSystem;
    return {
      weightKg: canonicalWeight(Number(direct[1]), inputUnitSystem),
      reps: Number(direct[3]),
      matchedPhrase: direct[0].trim(),
    };
  }

  const tokens = normalized.split(' ');
  for (let separator = 0; separator < tokens.length; separator += 1) {
    if (!volumeSeparators.has(tokens[separator])) continue;
    let leftEnd = separator - 1;
    const explicitUnit = weightUnits.has(tokens[leftEnd]) ? tokens[leftEnd] : null;
    while (leftEnd >= 0 && weightUnits.has(tokens[leftEnd])) leftEnd -= 1;
    const leftStart = numberStart(tokens, leftEnd);
    const rightEnd = numberEnd(tokens, separator + 1);
    if (leftStart > leftEnd || rightEnd < separator + 1) continue;
    const weightKg = parseNumber(tokens.slice(leftStart, leftEnd + 1));
    const reps = parseNumber(tokens.slice(separator + 1, rightEnd + 1));
    if (weightKg === null || reps === null) continue;
    return {
      weightKg: canonicalWeight(
        weightKg,
        explicitUnit ? (imperialWeightUnits.has(explicitUnit) ? 'imperial' : 'metric') : unitSystem,
      ),
      reps,
      matchedPhrase: tokens.slice(leftStart, rightEnd + 1).join(' '),
    };
  }
  return null;
}

function findRir(normalized: string) {
  if (
    containsPhrase(normalized, 'до отказа') ||
    containsPhrase(normalized, 'без запаса') ||
    containsPhrase(normalized, 'to failure')
  ) {
    return {
      value: 0,
      matchedPhrase: containsPhrase(normalized, 'до отказа')
        ? 'до отказа'
        : containsPhrase(normalized, 'без запаса')
          ? 'без запаса'
          : 'to failure',
    };
  }

  const explicit = normalized.match(/(?:rir|рир)\s*(\d+|[а-я]+)/);
  if (explicit) {
    const value = parseNumber([explicit[1]]);
    if (value !== null) return { value, matchedPhrase: explicit[0] };
  }

  const reserve = normalized.match(/(\d+|[а-я]+)\s+(?:повтор(?:а|ов)?\s+)?в\s+запасе/);
  if (reserve) {
    const value = parseNumber([reserve[1]]);
    if (value !== null) return { value, matchedPhrase: reserve[0] };
  }
  const englishReserve = normalized.match(/(\d+)\s+(?:reps?\s+)?in\s+reserve/);
  if (englishReserve) {
    return { value: Number(englishReserve[1]), matchedPhrase: englishReserve[0] };
  }
  return null;
}

function tr(locale: CurrentUser['locale'], russian: string, english: string) {
  return locale === 'en' ? english : russian;
}

function extractComment(original: string, normalized: string, phrases: string[]) {
  const clauseComment = original
    .replace(/(\d)[,.](\d)/g, '$1decsep$2')
    .split(/[,;.!?]+/)
    .map((clause) => clause.replaceAll('decsep', '.').trim())
    .filter(Boolean)
    .filter((clause) => {
      const normalizedClause = normalize(clause).replaceAll('|', '').trim();
      return !phrases.some((phrase) => phrase && containsPhrase(normalizedClause, phrase));
    })
    .join(', ')
    .trim();
  if (clauseComment) return clauseComment;

  let remainder = normalized;
  for (const phrase of phrases.filter(Boolean).sort((left, right) => right.length - left.length)) {
    remainder = remainder.replace(new RegExp(`(?:^|\\s)${escapeRegex(phrase)}(?=\\s|$)`), ' ');
  }
  remainder = remainder
    .replace(
      /(?:^|\s)(?:слушай|запиши|записать|добавь|добавить|подход|я|делаю|сделал|сделала|вес|кг|килограмм(?:а|ов)?|please|log|set)(?=\s|$)/g,
      ' ',
    )
    .replace(/\|/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^(?:и|а|с|это)\s+/, '')
    .trim();
  return remainder || null;
}

function parseNumber(tokens: string[]) {
  if (!tokens.length) return null;
  if (tokens.length === 1 && /^\d+(?:\.\d+)?$/.test(tokens[0])) return Number(tokens[0]);
  let value = 0;
  for (const token of tokens) {
    const part = numberWords[token];
    if (part === undefined) return null;
    value += part;
  }
  return value;
}

function numberStart(tokens: string[], end: number) {
  let start = end;
  while (start >= 0 && isNumberToken(tokens[start])) start -= 1;
  return start + 1;
}

function numberEnd(tokens: string[], start: number) {
  let end = start;
  while (end < tokens.length && isNumberToken(tokens[end])) end += 1;
  return end - 1;
}

function isNumberToken(token: string) {
  return /^\d+(?:\.\d+)?$/.test(token) || numberWords[token] !== undefined;
}

function normalize(value: string) {
  return value
    .toLocaleLowerCase('ru-RU')
    .replaceAll('ё', 'е')
    .replace(/(\d)[,.](\d)/g, '$1decsep$2')
    .replace(/[×*]/g, ' x ')
    .replace(/[.,:;!?]+/g, ' | ')
    .replaceAll('decsep', '.')
    .replace(/[^a-zа-я0-9.|]+/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function containsPhrase(haystack: string, needle: string) {
  return ` ${haystack} `.includes(` ${needle} `);
}

function findMatchedPhrase(haystack: string, needle: string) {
  if (containsPhrase(haystack, needle)) return needle;
  const haystackTokens = haystack.split(' ');
  const needleTokens = needle.split(' ');
  for (let index = 0; index <= haystackTokens.length - needleTokens.length; index += 1) {
    const window = haystackTokens.slice(index, index + needleTokens.length);
    if (
      window.every((token, tokenIndex) => {
        const expected = needleTokens[tokenIndex];
        return token === expected || (expected.length >= 5 && editDistance(token, expected) === 1);
      })
    ) {
      return window.join(' ');
    }
  }
  return null;
}

function clarification(question: string): NaturalSetResult {
  return { status: 'needs_clarification', question, candidates: [] };
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function editDistance(left: string, right: string) {
  const row = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    let previous = row[0];
    row[0] = leftIndex;
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const current = row[rightIndex];
      row[rightIndex] = Math.min(
        row[rightIndex] + 1,
        row[rightIndex - 1] + 1,
        previous + (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1),
      );
      previous = current;
    }
  }
  return row[right.length];
}
