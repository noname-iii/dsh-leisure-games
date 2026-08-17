/**
 * Skill label/description dictionary keys for the gomoku panel.
 */
import type { SkillId } from './engine.ts'
import type { LeisureKey } from '../../locales.ts'

/** Short skill names. */
export const SKILL_LABEL_KEYS: Record<SkillId, LeisureKey> = {
  dianxue: 'gomoku.skill.dianxue',
  daofan: 'gomoku.skill.daofan',
  gaitou: 'gomoku.skill.gaitou',
  leiting: 'gomoku.skill.leiting',
  heyiwei: 'gomoku.skill.heyiwei',
  touxi: 'gomoku.skill.touxi',
}

/** Skill descriptions. */
export const SKILL_DESC_KEYS: Record<SkillId, LeisureKey> = {
  dianxue: 'gomoku.skill.dianxue.desc',
  daofan: 'gomoku.skill.daofan.desc',
  gaitou: 'gomoku.skill.gaitou.desc',
  leiting: 'gomoku.skill.leiting.desc',
  heyiwei: 'gomoku.skill.heyiwei.desc',
  touxi: 'gomoku.skill.touxi.desc',
}
