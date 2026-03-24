export interface MinimalConfigRecord {
  readonly id?: number;
  readonly configKey?: string;
  readonly configType?: string;
  readonly configName?: string | null;
  readonly resultGroup?: string | null;
}

export function buildRunCommand(configType: unknown, configKey: unknown): string | null {
  if (configType === 'training') {
    return `docker compose run --rm train sh -lc "npm install && npm run build && npm run train -- ${configKey}"`;
  }

  if (configType === 'validation') {
    return `docker compose run --rm train sh -lc "npm install && npm run build && npm run validate -- ${configKey}"`;
  }

  return null;
}

export function resolveAllowedActions(configType: unknown): readonly string[] {
  if (configType === 'training') {
    return ['train', 'generate-validation', 'build-router', 'feature-causality', 'goal-tracking'];
  }

  if (configType === 'validation') {
    return ['validate', 'cost-sensitivity', 'router-validate'];
  }

  return [];
}

export function resolveRunRequestAction(configType: unknown, requestedAction: unknown): string {
  const normalizedConfigType = String(configType || '');
  const allowedActions = resolveAllowedActions(normalizedConfigType);

  if (allowedActions.length === 0) {
    throw new Error(`Only training or validation config can be queued, got ${normalizedConfigType}`);
  }

  const action = String(requestedAction || (normalizedConfigType === 'training' ? 'train' : 'validate'));
  if (!allowedActions.includes(action)) {
    throw new Error(`Action ${action} is not allowed for config type ${normalizedConfigType}`);
  }

  return action;
}

export function buildClearResultsPlan(
  primaryConfig: MinimalConfigRecord,
  relatedConfigs: readonly MinimalConfigRecord[] = []
): {
  readonly resultGroups: readonly string[];
  readonly removableConfigs: readonly MinimalConfigRecord[];
} {
  const resultGroups = Array.from(new Set(
    [primaryConfig?.resultGroup, ...relatedConfigs.map((item) => item?.resultGroup)]
      .filter(Boolean)
      .map((item) => String(item))
  ));

  const removableConfigs = String(primaryConfig?.configType || '') === 'training'
    ? relatedConfigs.filter((item) => {
      const configType = String(item?.configType || '');
      return configType === 'validation'
        || configType === 'top-strategies'
        || configType === 'router'
        || configType === 'policy';
    })
    : [];

  return {
    resultGroups,
    removableConfigs,
  };
}
