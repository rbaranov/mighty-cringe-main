import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { TrainerConnectionControls, TrainerDashboard } from './TrainerAccess';

describe('TrainerDashboard', () => {
  it('explains full training-log access after the invitation is accepted', () => {
    const html = renderToStaticMarkup(<TrainerDashboard onBack={() => {}} />);
    expect(html).toContain('Подопечные');
    expect(html).toContain('После принятия приглашения ты сможешь вести спортивный журнал');
    expect(html).toContain('Подопечный может отключить тебя в настройках');
    expect(html).toContain('Создать ссылку на 7 дней');
    expect(html).not.toContain('Изменить тренировку');
    expect(html).not.toContain('отдельно разрешает');
  });

  it('offers one disconnect action with complete sporting scope and no editing-permission step', () => {
    const html = renderToStaticMarkup(
      <TrainerConnectionControls
        trainerName="Роман"
        confirming={false}
        saving={false}
        onRequestDisconnect={vi.fn()}
        onDisconnect={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(html).toContain(
      'добавлять, изменять и удалять тренировки, подходы, замеры, избранное и упражнения',
    );
    expect(html).toContain('Аккаунт, аудиозаписи и управление доступом остаются только у тебя');
    expect(html.match(/<button /g)).toHaveLength(1);
    expect(html).toContain('>Отключить тренера</button>');
    expect(html).not.toContain('Разрешить');
    expect(html).not.toContain('только просмотр');
  });

  it('confirms full disconnection, names the trainer, and explains that existing changes remain', () => {
    const html = renderToStaticMarkup(
      <TrainerConnectionControls
        trainerName="Роман"
        confirming
        saving={false}
        onRequestDisconnect={vi.fn()}
        onDisconnect={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(html).toContain('Отключить тренера Роман?');
    expect(html).toContain('сразу потеряет возможность смотреть и изменять');
    expect(html).toContain('Уже внесённые изменения сохранятся');
    expect(html).toContain('>Да, отключить</button>');
    expect(html).toContain('>Отмена</button>');
  });
});
