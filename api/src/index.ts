import { boot } from './main';

export * from './main';

// Entry point alias for server execution
if (require.main === module) {
  boot();
}
