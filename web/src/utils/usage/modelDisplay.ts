const normalizeModelName = (value: unknown): string => String(value ?? '').trim()

const comparableModelName = (value: string): string => value.toLowerCase()

export interface UsageModelDisplay {
  model: string
  responseModel: string
  modelAlias: string
}

export const getUsageModelDisplay = (
  modelValue: unknown,
  responseModelValue: unknown,
  modelAliasValue: unknown,
): UsageModelDisplay => {
  const model = normalizeModelName(modelValue)
  const responseModel = normalizeModelName(responseModelValue)
  const modelAlias = normalizeModelName(modelAliasValue)
  const comparableModel = comparableModelName(model)

  return {
    model: model || '-',
    responseModel: responseModel && comparableModelName(responseModel) !== comparableModel
      ? responseModel
      : '',
    modelAlias: modelAlias && comparableModelName(modelAlias) !== comparableModel
      ? modelAlias
      : '',
  }
}
