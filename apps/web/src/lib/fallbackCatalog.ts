import type { Exercise } from '@mighty-cringe/contracts';

export const retiredGlobalExerciseIds = new Set([
  '10000000-0000-4000-8000-000000000011',
  '10000000-0000-4000-8000-000000000012',
]);

export const fallbackCatalog: Exercise[] = [
  {
    id: '10000000-0000-4000-8000-000000000001',
    nameRu: 'Тяга верхнего блока',
    nameEn: 'Lat pulldown',
    aliases: ['верхний блок', 'lat pulldown'],
    tag: 'normal',
    primaryMuscles: ['back'],
    secondaryMuscles: ['biceps', 'rear_delt'],
    equipment: ['cable machine'],
    videos: [
      {
        title: 'Техника тяги верхнего блока',
        url: 'https://www.youtube.com/watch?v=CAwf7n6Luuc',
      },
    ],
  },
  {
    id: '10000000-0000-4000-8000-000000000002',
    nameRu: 'Разведения гантелей в стороны',
    nameEn: 'Dumbbell lateral raise',
    aliases: ['махи в стороны', 'lateral raise'],
    tag: 'normal',
    primaryMuscles: ['middle_delt'],
    secondaryMuscles: [],
    equipment: ['dumbbells'],
    videos: [
      {
        title: 'Техника разведений гантелей',
        url: 'https://www.youtube.com/watch?v=3VcKaXpzqRo',
      },
    ],
  },
  {
    id: '10000000-0000-4000-8000-000000000003',
    nameRu: 'Жим лёжа',
    nameEn: 'Bench press',
    aliases: ['жим штанги лёжа', 'bench press'],
    tag: 'mighty',
    primaryMuscles: ['chest'],
    secondaryMuscles: ['triceps', 'front_delt'],
    equipment: ['barbell'],
    videos: [
      {
        title: 'Техника жима штанги лёжа',
        url: 'https://www.youtube.com/watch?v=rT7DgCr-3pg',
      },
    ],
  },
  {
    id: '10000000-0000-4000-8000-000000000004',
    nameRu: 'Сгибание рук с гантелями',
    nameEn: 'Dumbbell curl',
    aliases: ['сгибания на бицепс', 'dumbbell curl'],
    tag: 'normal',
    primaryMuscles: ['biceps'],
    secondaryMuscles: [],
    equipment: ['dumbbells'],
    videos: [
      {
        title: 'Техника сгибаний с гантелями',
        url: 'https://www.youtube.com/watch?v=ykJmrZ5v0Oo',
      },
    ],
  },
  {
    id: '10000000-0000-4000-8000-000000000005',
    nameRu: 'Приседания со штангой',
    nameEn: 'Barbell squat',
    aliases: ['присед', 'squat'],
    tag: 'normal',
    primaryMuscles: ['quadriceps'],
    secondaryMuscles: ['hamstrings', 'core'],
    equipment: ['barbell'],
    videos: [
      {
        title: 'Техника приседаний со штангой',
        url: 'https://www.youtube.com/watch?v=ultWZbUMPL8',
      },
    ],
  },
  {
    id: '10000000-0000-4000-8000-000000000006',
    nameRu: 'Разгибание рук на блоке',
    nameEn: 'Cable triceps extension',
    aliases: ['трицепс на блоке', 'pushdown'],
    tag: 'normal',
    primaryMuscles: ['triceps'],
    secondaryMuscles: [],
    equipment: ['cable machine'],
    videos: [
      {
        title: 'Техника разгибаний рук на блоке',
        url: 'https://www.youtube.com/watch?v=2-LAMcpzODU',
      },
    ],
  },
  {
    id: '10000000-0000-4000-8000-000000000007',
    nameRu: 'Румынская тяга',
    nameEn: 'Romanian deadlift',
    aliases: ['румынка', 'romanian deadlift', 'rdl'],
    tag: 'cringe',
    primaryMuscles: ['hamstrings'],
    secondaryMuscles: ['back', 'core'],
    equipment: ['barbell'],
    videos: [
      {
        title: 'Техника румынской тяги',
        url: 'https://www.youtube.com/watch?v=JCXUYuzwNrM',
      },
    ],
  },
  {
    id: '10000000-0000-4000-8000-000000000008',
    nameRu: 'Тяга горизонтального блока',
    nameEn: 'Seated cable row',
    aliases: ['горизонтальный блок', 'seated row'],
    tag: 'mighty',
    primaryMuscles: ['back'],
    secondaryMuscles: ['biceps', 'rear_delt'],
    equipment: ['cable machine'],
    videos: [
      {
        title: 'Техника тяги горизонтального блока',
        url: 'https://www.youtube.com/watch?v=GZbfZ033f74',
      },
    ],
  },
  {
    id: '10000000-0000-4000-8000-000000000009',
    nameRu: 'Жим штанги стоя',
    nameEn: 'Overhead press',
    aliases: ['армейский жим', 'overhead press', 'ohp'],
    tag: 'mighty',
    primaryMuscles: ['front_delt', 'middle_delt'],
    secondaryMuscles: ['triceps', 'core'],
    equipment: ['barbell'],
    videos: [
      {
        title: 'Техника жима штанги стоя',
        url: 'https://www.youtube.com/watch?v=2yjwXTZQDDI',
      },
    ],
  },
  {
    id: '10000000-0000-4000-8000-000000000010',
    nameRu: 'Болгарские выпады',
    nameEn: 'Bulgarian split squat',
    aliases: ['болгарские приседания', 'split squat'],
    tag: 'cringe',
    primaryMuscles: ['quadriceps'],
    secondaryMuscles: ['hamstrings', 'core'],
    equipment: ['dumbbells', 'bench'],
    videos: [
      {
        title: 'Техника болгарских выпадов',
        url: 'https://www.youtube.com/watch?v=2C-uNgKwPLE',
      },
    ],
  },
  {
    id: '10000000-0000-4000-8000-000000000011',
    nameRu: 'Подъёмы на носки стоя',
    nameEn: 'Standing calf raise',
    aliases: ['икры стоя', 'calf raise'],
    tag: 'normal',
    primaryMuscles: ['calves'],
    secondaryMuscles: [],
    equipment: ['machine'],
  },
  {
    id: '10000000-0000-4000-8000-000000000012',
    nameRu: 'Планка',
    nameEn: 'Plank',
    aliases: ['планка на локтях', 'plank'],
    tag: 'normal',
    primaryMuscles: ['core'],
    secondaryMuscles: ['front_delt'],
    equipment: ['bodyweight'],
  },
  {
    id: '10000000-0000-4000-8000-000000000013',
    nameRu: 'Жим гантелей лёжа на грудь',
    nameEn: 'Dumbbell bench press',
    aliases: ['жим гантелей лёжа', 'жим гантелей на грудь', 'dumbbell bench press'],
    tag: 'mighty',
    primaryMuscles: ['chest'],
    secondaryMuscles: ['triceps', 'front_delt'],
    equipment: ['dumbbells', 'bench'],
    videos: [
      {
        title: 'Техника жима гантелей лёжа',
        url: 'https://www.youtube.com/watch?v=VmB1G1K7v94',
      },
    ],
  },
  {
    id: '10000000-0000-4000-8000-000000000014',
    nameRu: 'Сведение рук в тренажёре',
    nameEn: 'Pec deck fly',
    aliases: ['бабочка на грудь', 'сведение рук бабочка', 'pec deck fly'],
    tag: 'mighty',
    primaryMuscles: ['chest'],
    secondaryMuscles: ['front_delt'],
    equipment: ['machine'],
    videos: [
      {
        title: 'Техника сведений рук в тренажёре',
        url: 'https://www.youtube.com/watch?v=Z57CtFmRMxA',
      },
    ],
  },
  {
    id: '10000000-0000-4000-8000-000000000015',
    nameRu: 'Сведение рук в кроссовере',
    nameEn: 'Cable crossover',
    aliases: ['кроссовер на грудь', 'сведение рук на грудь', 'cable crossover'],
    tag: 'mighty',
    primaryMuscles: ['chest'],
    secondaryMuscles: ['front_delt'],
    equipment: ['cable machine'],
    videos: [
      {
        title: 'Техника сведений рук в кроссовере',
        url: 'https://www.youtube.com/watch?v=taI4XduLpTk',
      },
    ],
  },
  {
    id: '10000000-0000-4000-8000-000000000016',
    nameRu: 'Подтягивания',
    nameEn: 'Pull-up',
    aliases: ['подтягивание', 'pull up', 'pull-up'],
    tag: 'normal',
    primaryMuscles: ['back'],
    secondaryMuscles: ['biceps', 'rear_delt'],
    equipment: ['pull-up bar'],
    videos: [
      {
        title: 'Техника подтягиваний',
        url: 'https://www.youtube.com/watch?v=eGo4IYlbE5g',
      },
    ],
  },
  {
    id: '10000000-0000-4000-8000-000000000017',
    nameRu: 'Жим ногами в тренажёре',
    nameEn: 'Leg press',
    aliases: ['жим ногами', 'leg press'],
    tag: 'normal',
    primaryMuscles: ['quadriceps'],
    secondaryMuscles: ['hamstrings'],
    equipment: ['machine'],
    videos: [
      {
        title: 'Техника жима ногами',
        url: 'https://www.youtube.com/watch?v=IZxyjW7MPJQ',
      },
    ],
  },
  {
    id: '10000000-0000-4000-8000-000000000018',
    nameRu: 'Жим штанги лёжа на наклонной скамье',
    nameEn: 'Incline barbell bench press',
    aliases: [
      'жим штанги лежа на наклонной скамье',
      'жим лежа на наклонной скамье',
      'наклонный жим штанги',
      'incline bench press',
    ],
    tag: 'mighty',
    primaryMuscles: ['chest'],
    secondaryMuscles: ['triceps', 'front_delt'],
    equipment: ['barbell', 'incline bench'],
    videos: [
      {
        title: 'Техника наклонного жима штанги',
        url: 'https://www.youtube.com/watch?v=SrqOu55lrYU',
      },
    ],
  },
];
