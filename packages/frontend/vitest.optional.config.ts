import { configDefaults, defineConfig } from 'vitest/config';
import appConfig, { optionalSpecs } from './vitest.config.ts';

export default defineConfig({
  ...appConfig,
  test: {
    ...appConfig.test,
    include: optionalSpecs,
    exclude: configDefaults.exclude,
  },
});
