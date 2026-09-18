import { describe, expect, it } from 'vitest'
import { getUsageModelDisplay } from './modelDisplay'

describe('getUsageModelDisplay', () => {
  it('keeps a distinct response model and alias in display order', () => {
    expect(getUsageModelDisplay(' deepseek-v4-flash ', 'deepseek-v4.1-flash', 'deepseek-flash')).toEqual({
      model: 'deepseek-v4-flash',
      responseModel: 'deepseek-v4.1-flash',
      modelAlias: 'deepseek-flash',
    })
  })

  it('hides empty or case-insensitively matching response and alias values', () => {
    expect(getUsageModelDisplay('DeepSeek-V4-Flash', ' deepseek-v4-flash ', 'DEEPSEEK-V4-FLASH')).toEqual({
      model: 'DeepSeek-V4-Flash',
      responseModel: '',
      modelAlias: '',
    })
  })

  it('uses a dash only for a missing requested model', () => {
    expect(getUsageModelDisplay('', 'served-model', 'client-alias')).toEqual({
      model: '-',
      responseModel: 'served-model',
      modelAlias: 'client-alias',
    })
  })
})
