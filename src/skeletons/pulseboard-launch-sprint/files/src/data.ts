import type { LaunchTask } from './App';

export const initialLaunchTasks: LaunchTask[] = [
  { id: 1, title: 'Ship launch hero copy', owner: 'Mina', lane: 'Brand', status: 'ready' },
  { id: 2, title: 'Validate billing edge cases', owner: 'Ilya', lane: 'Platform', status: 'watch' },
  { id: 3, title: 'Close mobile layout regressions', owner: 'Jules', lane: 'Frontend', status: 'blocked' },
  { id: 4, title: 'Approve onboarding screenshots', owner: 'Rae', lane: 'Product', status: 'ready' },
  { id: 5, title: 'Re-run analytics smoke tests', owner: 'Niko', lane: 'Data', status: 'watch' },
  { id: 6, title: 'Finalize status page wording', owner: 'Ava', lane: 'Ops', status: 'ready' },
];

export const activityFeed = [
  { time: '09:40', title: 'Launch brief approved', detail: 'Design and GTM both signed off on the rollout narrative.' },
  { time: '10:05', title: 'Regression found', detail: 'A mobile spacing issue surfaced in the onboarding stepper.' },
  { time: '11:15', title: 'Recovery plan posted', detail: 'Frontend documented a narrow fix and re-test path for QA.' },
];

export const releaseStats = [
  { label: 'Launch score', value: '92', note: '+6 this morning' },
  { label: 'Critical blockers', value: '01', note: 'One issue still owned' },
  { label: 'Teams aligned', value: '06', note: 'Design, web, ops, data' },
];
