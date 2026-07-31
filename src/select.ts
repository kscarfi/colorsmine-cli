import { selectRoles, type NamedColor, type RoleOverrides, type RoleSelection } from './engine/roleSelection'
import type { Token } from './color'

export type { RoleOverrides }

/**
 * The CLI works in file Tokens (which carry the file they came from); the
 * shared heuristic works in name/hex pairs, because that is all the Figma
 * plugin has. This maps between them and puts the source back on the way out,
 * so both surfaces pick the same colors for the same reasons.
 */
export interface Selection {
  hexes: string[]
  picks: { role: string; token: Token; pinned: boolean }[]
  named: boolean
  missing: string[]
  ungraded: Token[]
  roles: Record<string, string>
}

export function selectPalette(tokens: Token[], overrides: RoleOverrides = {}): Selection {
  const sel: RoleSelection = selectRoles(tokens.map(t => ({ name: t.name, hex: t.hex })), overrides)
  const back = (c: NamedColor): Token =>
    tokens.find(t => t.name === c.name && t.hex === c.hex) ?? { ...c, source: '' }
  return {
    hexes: sel.hexes,
    picks: sel.picks.map(p => ({ role: p.role, token: back(p.color), pinned: p.pinned })),
    named: sel.named,
    missing: sel.missing,
    ungraded: sel.ungraded.map(back),
    roles: sel.roles,
  }
}
