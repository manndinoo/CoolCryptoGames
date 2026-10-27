// The four inspection grades, plus the two gray states that are not grades.
// Shared by the browser and the server.

export const GRADES = ['critical', 'high', 'monitor', 'clear'];
export const ALL_STATES = [...GRADES, 'inconclusive', 'unreviewed'];

export const GRADE_INFO = {
  critical: { label: 'Critical', short: 'Critical', color: '#d6453d', response: 'Immediate utility review. Do not wait for the schedule.' },
  high: { label: 'Priority', short: 'Priority', color: '#8b55c7', response: 'Prompt qualified assessment and a work order.' },
  monitor: { label: 'Monitor', short: 'Monitor', color: '#d9a21b', response: 'Maintenance or re-inspection on the normal cycle.' },
  clear: { label: 'No issues', short: 'No issues', color: '#3a9a62', response: 'Routine schedule. Never a certification that the pole is safe to climb or work.' },
  inconclusive: { label: 'Needs more evidence', short: 'More evidence', color: '#7d8a96', response: 'Retake the missing views or assess in the field. Never treated as No issues.' },
  unreviewed: { label: 'Not inspected', short: 'Not inspected', color: '#a3adb7', response: 'No inspection on record yet.' },
};

// Lower number = more urgent.
export const RANK = { critical: 0, high: 1, monitor: 2, inconclusive: 3, unreviewed: 4, clear: 5 };

export const mostUrgent = grades => grades.filter(g => g in RANK).sort((a, b) => RANK[a] - RANK[b])[0];

// Recommended photo set. Coverage of these views is what lets the AI (and a
// reviewer) say "No issues" rather than "Needs more evidence".
export const VIEWS = [
  { id: 'full', label: 'Whole pole', hint: 'Step back until top to ground fits in frame.' },
  { id: 'top', label: 'Top & crossarms', hint: 'Insulators, pins, ties, arms, braces.' },
  { id: 'equipment', label: 'Equipment', hint: 'Transformer, cutouts, arresters, switches, if present.' },
  { id: 'attachments', label: 'Guys & attachments', hint: 'Down guys, anchors, guards, comm attachments.' },
  { id: 'groundline', label: 'Groundline', hint: 'Base of pole, soil, rot, damage.' },
  { id: 'tag', label: 'Pole tag', hint: 'ID plate or birthmark, close up.' },
];

export const STRUCTURES = [
  { id: 'tangent', label: 'Tangent' },
  { id: 'deadend', label: 'Dead-end' },
  { id: 'angle', label: 'Angle' },
  { id: 'transformer', label: 'Transformer' },
  { id: 'deadend_transformer', label: 'Dead-end + transformer' },
  { id: 'tangent_transformer', label: 'Tangent + transformer' },
  { id: 'switch', label: 'Switch / recloser' },
  { id: 'riser', label: 'Riser' },
  { id: 'service', label: 'Service pole' },
  { id: 'tower', label: 'Steel tower' },
  { id: 'other', label: 'Other' },
];

export const MATERIALS = ['wood', 'steel', 'concrete', 'composite', 'lattice', 'unknown'];
