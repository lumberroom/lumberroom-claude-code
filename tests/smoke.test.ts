import { describe, expect, test } from 'claude-code/testing'

import { CLOSED } from '../src/breaker'
import { DEFAULTS } from '../src/config'

describe('toolchain', () => {
  test('imports from src resolve', async () => {
    expect(CLOSED.failures).toBe(0)
    expect(DEFAULTS.recallMaxChars).toBe(4000)
  })
})
