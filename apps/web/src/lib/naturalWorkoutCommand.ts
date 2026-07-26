import type { CurrentUser, Exercise, WorkoutExercise } from '@mighty-cringe/contracts';

import { matchExerciseText } from './naturalSet';

export type WorkoutCommandExerciseRole = 'source' | 'target' | 'anchor';

type PlanExercise = {
  item: WorkoutExercise;
  exercise: Exercise;
};

export type NaturalWorkoutCommand =
  | { type: 'add'; exercise: Exercise; anchor: PlanExercise | null; placement: 'before' | 'after' }
  | { type: 'replace'; source: PlanExercise; replacement: Exercise }
  | { type: 'remove'; source: PlanExercise }
  | { type: 'move'; source: PlanExercise; anchor: PlanExercise; placement: 'before' | 'after' };

export type NaturalWorkoutCommandResult =
  | { status: 'not_command' }
  | { status: 'command_ready'; command: NaturalWorkoutCommand }
  | {
      status: 'command_needs_clarification';
      question: string;
      candidates: Exercise[];
      role: WorkoutCommandExerciseRole;
      unresolvedPhrase?: string;
    };

export type WorkoutCommandOverrides = Partial<Record<WorkoutCommandExerciseRole, Exercise>>;

type ParsedIntent =
  | { type: 'add'; target: string; anchor: string | null; placement: 'before' | 'after' }
  | { type: 'replace'; source: string; target: string }
  | { type: 'remove'; source: string }
  | { type: 'move'; source: string; anchor: string; placement: 'before' | 'after' };

export function parseNaturalWorkoutCommand({
  text,
  catalog,
  plan,
  locale = 'ru',
  overrides = {},
}: {
  text: string;
  catalog: Exercise[];
  plan: WorkoutExercise[];
  locale?: CurrentUser['locale'];
  overrides?: WorkoutCommandOverrides;
}): NaturalWorkoutCommandResult {
  const intent = parseIntent(text);
  if (!intent) return { status: 'not_command' };

  const planExercises = plan
    .slice()
    .sort((left, right) => left.position - right.position)
    .flatMap((item) => {
      const exercise = catalog.find((candidate) => candidate.id === item.exerciseId);
      return exercise ? [{ item, exercise }] : [];
    });

  if (intent.type === 'add') {
    const target = resolveExercise({
      phrase: intent.target,
      candidates: catalog.filter(
        (exercise) => !planExercises.some((current) => current.exercise.id === exercise.id),
      ),
      override: overrides.target,
      role: 'target',
      locale,
    });
    if ('question' in target) return target;
    if (!intent.anchor) {
      return {
        status: 'command_ready',
        command: { type: 'add', exercise: target.exercise, anchor: null, placement: 'after' },
      };
    }
    const anchor = resolvePlanExercise({
      phrase: intent.anchor,
      planExercises,
      override: overrides.anchor,
      role: 'anchor',
      locale,
    });
    if ('question' in anchor) return anchor;
    return {
      status: 'command_ready',
      command: {
        type: 'add',
        exercise: target.exercise,
        anchor: anchor.planExercise,
        placement: intent.placement,
      },
    };
  }

  const source = resolvePlanExercise({
    phrase: intent.source,
    planExercises,
    override: overrides.source,
    role: 'source',
    locale,
  });
  if ('question' in source) return source;

  if (intent.type === 'remove') {
    return { status: 'command_ready', command: { type: 'remove', source: source.planExercise } };
  }

  if (intent.type === 'replace') {
    const replacement = resolveExercise({
      phrase: intent.target,
      candidates: catalog.filter(
        (exercise) =>
          exercise.id === source.planExercise.exercise.id ||
          !planExercises.some((current) => current.exercise.id === exercise.id),
      ),
      override: overrides.target,
      role: 'target',
      locale,
    });
    if ('question' in replacement) return replacement;
    if (replacement.exercise.id === source.planExercise.exercise.id) {
      return clarification(
        locale,
        'target',
        'Выбрано то же упражнение. Укажи, на что его заменить.',
        'That is the same exercise. Choose a different replacement.',
        catalog.filter(
          (exercise) => !planExercises.some((current) => current.exercise.id === exercise.id),
        ),
      );
    }
    return {
      status: 'command_ready',
      command: { type: 'replace', source: source.planExercise, replacement: replacement.exercise },
    };
  }

  const anchor = resolvePlanExercise({
    phrase: intent.anchor,
    planExercises: planExercises.filter(
      (candidate) => candidate.item.id !== source.planExercise.item.id,
    ),
    override: overrides.anchor,
    role: 'anchor',
    locale,
  });
  if ('question' in anchor) return anchor;
  return {
    status: 'command_ready',
    command: {
      type: 'move',
      source: source.planExercise,
      anchor: anchor.planExercise,
      placement: intent.placement,
    },
  };
}

export function workoutCommandSummary(
  command: NaturalWorkoutCommand,
  locale: CurrentUser['locale'],
) {
  const name = (exercise: Exercise) => (locale === 'en' ? exercise.nameEn : exercise.nameRu);
  switch (command.type) {
    case 'add':
      if (!command.anchor) {
        return tr(
          locale,
          `Добавить «${name(command.exercise)}» в конец плана.`,
          `Add “${name(command.exercise)}” to the end of the plan.`,
        );
      }
      return tr(
        locale,
        `Добавить «${name(command.exercise)}» ${command.placement === 'before' ? 'перед' : 'после'} «${name(command.anchor.exercise)}».`,
        `Add “${name(command.exercise)}” ${command.placement} “${name(command.anchor.exercise)}”.`,
      );
    case 'replace':
      return tr(
        locale,
        `Заменить «${name(command.source.exercise)}» на «${name(command.replacement)}». Уже записанные подходы останутся в истории.`,
        `Replace “${name(command.source.exercise)}” with “${name(command.replacement)}”. Logged sets will remain in history.`,
      );
    case 'remove':
      return tr(
        locale,
        `Убрать «${name(command.source.exercise)}» из плана. Уже записанные подходы останутся в истории.`,
        `Remove “${name(command.source.exercise)}” from the plan. Logged sets will remain in history.`,
      );
    case 'move':
      return tr(
        locale,
        `Переставить «${name(command.source.exercise)}» ${command.placement === 'before' ? 'перед' : 'после'} «${name(command.anchor.exercise)}».`,
        `Move “${name(command.source.exercise)}” ${command.placement} “${name(command.anchor.exercise)}”.`,
      );
  }
}

function parseIntent(text: string): ParsedIntent | null {
  const value = text
    .trim()
    .replace(/[.!?]+$/u, '')
    .replace(/\s+/gu, ' ')
    .replace(
      /^(?:(?:(?:можешь|можете|можно)(?:\s+ли)?|пожалуйста|can you|could you|would you|please)\s*,?\s*)+/iu,
      '',
    );
  let match =
    /^(?:замени|заменить|поменяй|поменять|смени|replace|swap|change)\s+(.+?)\s+(?:на|with|to|for)\s+(.+)$/iu.exec(
      value,
    );
  if (match) {
    return {
      type: 'replace',
      source: stripWrappingQuotes(match[1]),
      target: stripWrappingQuotes(match[2]),
    };
  }

  match =
    /^(?:переставь|переставить|перемести|переместить|поставь|поставить|move|put)\s+(.+?)\s+(перед|после|before|after)\s+(.+)$/iu.exec(
      value,
    );
  if (match) {
    return {
      type: 'move',
      source: match[1].trim(),
      placement: /^(?:перед|before)$/iu.test(match[2]) ? 'before' : 'after',
      anchor: match[3].trim(),
    };
  }

  match =
    /^(?:добавь|добавить|вставь|вставить|add|insert)\s+(?:упражнение\s+|exercise\s+)?(.+?)(?:\s+(перед|после|before|after)\s+(.+))?$/iu.exec(
      value,
    );
  if (match) {
    return {
      type: 'add',
      target: match[1].trim(),
      placement: /^(?:перед|before)$/iu.test(match[2] ?? '') ? 'before' : 'after',
      anchor: match[3]?.trim() ?? null,
    };
  }

  match =
    /^(?:удали|удалить|убери|убрать|исключи|исключить|delete|remove)\s+(?:упражнение\s+|exercise\s+)?(.+)$/iu.exec(
      value,
    );
  if (match) return { type: 'remove', source: match[1].trim() };
  return null;
}

function stripWrappingQuotes(value: string) {
  return value
    .trim()
    .replace(/^(?:["'«„“]+)|(?:["'»“”]+)$/gu, '')
    .trim();
}

function resolvePlanExercise({
  phrase,
  planExercises,
  override,
  role,
  locale,
}: {
  phrase: string;
  planExercises: PlanExercise[];
  override: Exercise | undefined;
  role: 'source' | 'anchor';
  locale: CurrentUser['locale'];
}):
  | { planExercise: PlanExercise }
  | Extract<NaturalWorkoutCommandResult, { status: 'command_needs_clarification' }> {
  const resolved = resolveExercise({
    phrase,
    candidates: planExercises.map((item) => item.exercise),
    override,
    role,
    locale,
  });
  if ('question' in resolved) return resolved;
  const planExercise = planExercises.find((item) => item.exercise.id === resolved.exercise.id);
  if (!planExercise) {
    return clarification(
      locale,
      role,
      `Упражнения «${phrase}» нет в текущем плане. Выбери упражнение из плана.`,
      `“${phrase}” is not in the current plan. Choose an exercise from the plan.`,
      planExercises.map((item) => item.exercise),
    );
  }
  return { planExercise };
}

function resolveExercise({
  phrase,
  candidates,
  override,
  role,
  locale,
}: {
  phrase: string;
  candidates: Exercise[];
  override: Exercise | undefined;
  role: WorkoutCommandExerciseRole;
  locale: CurrentUser['locale'];
}):
  | { exercise: Exercise }
  | Extract<NaturalWorkoutCommandResult, { status: 'command_needs_clarification' }> {
  if (override) {
    const selected = candidates.find((candidate) => candidate.id === override.id);
    if (selected) return { exercise: selected };
  }
  const match = matchExerciseText(phrase, candidates) ?? matchInflectedExercise(phrase, candidates);
  if (!match) {
    const source = role === 'source' || role === 'anchor';
    return clarification(
      locale,
      role,
      source
        ? `Не нашёл «${phrase}» в текущем плане. Выбери нужное упражнение.`
        : `Не нашёл «${phrase}» в каталоге. Выбери упражнение или сначала добавь его в каталог.`,
      source
        ? `I could not find “${phrase}” in the current plan. Choose the exercise.`
        : `I could not find “${phrase}” in the catalog. Choose an exercise or add it to the catalog first.`,
      candidates,
      phrase,
    );
  }
  if ('candidates' in match) {
    return clarification(
      locale,
      role,
      'Какое именно упражнение ты имеешь в виду?',
      'Which exercise do you mean?',
      match.candidates,
      phrase,
    );
  }
  return { exercise: match.exercise };
}

function matchInflectedExercise(
  phrase: string,
  candidates: Exercise[],
): ReturnType<typeof matchExerciseText> {
  const phraseTokens = searchableTokens(phrase);
  const matches = candidates.flatMap((exercise) => {
    const variants = [exercise.nameRu, exercise.nameEn, ...exercise.aliases];
    const score = Math.max(
      0,
      ...variants.map((variant) => {
        const variantTokens = searchableTokens(variant);
        if (!variantTokens.length || variantTokens.length > phraseTokens.length) return 0;
        for (let offset = 0; offset <= phraseTokens.length - variantTokens.length; offset += 1) {
          if (
            variantTokens.every((token, index) =>
              inflectedTokenMatch(token, phraseTokens[offset + index]),
            )
          ) {
            return variantTokens.join(' ').length;
          }
        }
        return 0;
      }),
    );
    return score > 0 ? [{ exercise, matchedPhrase: phrase, score }] : [];
  });
  if (!matches.length) return null;
  const topScore = Math.max(...matches.map((match) => match.score));
  const top = matches.filter((match) => match.score === topScore);
  if (top.length > 1) return { candidates: top.map((match) => match.exercise) };
  return top[0];
}

function searchableTokens(value: string) {
  return value
    .toLocaleLowerCase('ru-RU')
    .replaceAll('ё', 'е')
    .replace(/[^a-zа-я0-9]+/giu, ' ')
    .trim()
    .split(/\s+/u)
    .filter(Boolean);
}

function inflectedTokenMatch(expected: string, actual: string) {
  if (expected === actual) return true;
  if (!/[а-я]/u.test(expected) || !/[а-я]/u.test(actual)) return false;
  const shortest = Math.min(expected.length, actual.length);
  if (shortest < 3) return false;
  let prefix = 0;
  while (prefix < shortest && expected[prefix] === actual[prefix]) prefix += 1;
  const requiredPrefix = shortest <= 4 ? 3 : Math.max(4, Math.floor(shortest * 0.6));
  return prefix >= requiredPrefix;
}

function clarification(
  locale: CurrentUser['locale'],
  role: WorkoutCommandExerciseRole,
  ru: string,
  en: string,
  candidates: Exercise[],
  unresolvedPhrase?: string,
): Extract<NaturalWorkoutCommandResult, { status: 'command_needs_clarification' }> {
  return {
    status: 'command_needs_clarification',
    question: tr(locale, ru, en),
    candidates,
    role,
    ...(unresolvedPhrase ? { unresolvedPhrase } : {}),
  };
}

function tr(locale: CurrentUser['locale'], ru: string, en: string) {
  return locale === 'en' ? en : ru;
}
