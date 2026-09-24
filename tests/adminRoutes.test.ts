import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ADMIN_NAV,
  ADMIN_SECTIONS,
  ADMIN_TAB_PERMISSIONS,
  adminSectionPath,
  adminSectionUrl,
  firstPermittedAdminTab,
  isAdminTab,
  isExamCenterView,
  resolveAdminRoute,
} from '../src/hooks/admin/adminRoutes.js';

test('adminSectionPath gives every section its own path', () => {
  assert.equal(adminSectionPath('overview'), '/admin/overview');
  assert.equal(adminSectionPath('dashboard'), '/admin/dashboard');
  assert.equal(adminSectionPath('classes'), '/admin/classes');
  assert.equal(adminSectionPath('devices'), '/admin/devices');
  assert.equal(adminSectionPath('users'), '/admin/users');
  // 考试中心不带视图时补默认视图，带视图时按视图落到二级页面。
  assert.equal(adminSectionPath('exam'), '/admin/exam/current');
  assert.equal(adminSectionPath('exam', null), '/admin/exam/current');
  assert.equal(adminSectionPath('exam', 'weekly'), '/admin/exam/weekly');
});

test('nav metadata covers every section exactly once', () => {
  assert.deepEqual(
    ADMIN_SECTIONS,
    ADMIN_NAV.map((item) => item.id),
  );
  for (const id of ADMIN_SECTIONS) {
    assert.ok(ADMIN_TAB_PERMISSIONS[id], `missing permission for ${id}`);
    assert.ok(isAdminTab(id));
  }
  assert.equal(isAdminTab('records'), false);
  assert.equal(isExamCenterView('editor'), true);
  assert.equal(isExamCenterView('overview'), false);
});

test('resolveAdminRoute keeps a canonical section URL as-is', () => {
  for (const id of ['overview', 'dashboard', 'classes', 'devices', 'users'] as const) {
    assert.deepEqual(resolveAdminRoute({ section: id, fallbackTab: 'overview' }), {
      tab: id,
      examView: null,
      explicit: true,
      path: `/admin/${id}`,
      redirect: false,
    });
  }
  assert.deepEqual(resolveAdminRoute({ section: 'exam', view: 'schedule', fallbackTab: 'overview' }), {
    tab: 'exam',
    examView: 'schedule',
    explicit: true,
    path: '/admin/exam/schedule',
    redirect: false,
  });
});

test('resolveAdminRoute fills in the default exam view', () => {
  const state = resolveAdminRoute({ section: 'exam', fallbackTab: 'overview' });
  assert.equal(state.tab, 'exam');
  assert.equal(state.examView, null);
  assert.equal(state.path, '/admin/exam/current');
  assert.equal(state.redirect, true);
});

test('resolveAdminRoute rewrites unknown views only for the exam center', () => {
  const exam = resolveAdminRoute({ section: 'exam', view: 'nope', fallbackTab: 'overview' });
  assert.equal(exam.examView, null);
  assert.equal(exam.path, '/admin/exam/current');
  assert.equal(exam.redirect, true);

  const classes = resolveAdminRoute({ section: 'classes', view: 'nope', fallbackTab: 'overview' });
  assert.equal(classes.tab, 'classes');
  assert.equal(classes.examView, null);
  assert.equal(classes.path, '/admin/classes');
  assert.equal(classes.redirect, true);
});

test('resolveAdminRoute maps the legacy ?tab= deep links onto paths', () => {
  const major = resolveAdminRoute({ legacyTab: 'major', fallbackTab: 'overview' });
  assert.deepEqual(major, {
    tab: 'exam',
    examView: 'editor',
    explicit: true,
    path: '/admin/exam/editor',
    redirect: true,
  });

  const weekly = resolveAdminRoute({ legacyTab: 'weekly', fallbackTab: 'overview' });
  assert.equal(weekly.path, '/admin/exam/weekly');
  assert.equal(weekly.explicit, true);

  const devices = resolveAdminRoute({ legacyTab: 'devices', fallbackTab: 'overview' });
  assert.equal(devices.tab, 'devices');
  assert.equal(devices.explicit, true);
  assert.equal(devices.redirect, true);

  // 旧的两段式深链 `?tab=exam&view=weekly` 也要落到周测。
  const examWeekly = resolveAdminRoute({ legacyTab: 'exam', legacyView: 'weekly', fallbackTab: 'overview' });
  assert.equal(examWeekly.tab, 'exam');
  assert.equal(examWeekly.examView, 'weekly');
  assert.equal(examWeekly.path, '/admin/exam/weekly');
});

test('resolveAdminRoute falls back without claiming the URL asked for a section', () => {
  const bare = resolveAdminRoute({ fallbackTab: 'classes' });
  assert.deepEqual(bare, {
    tab: 'classes',
    examView: null,
    explicit: false,
    path: '/admin/classes',
    redirect: true,
  });

  const unknown = resolveAdminRoute({ section: 'no-such-section', fallbackTab: 'overview' });
  assert.equal(unknown.tab, 'overview');
  assert.equal(unknown.explicit, false);
  assert.equal(unknown.redirect, true);

  // 路径里的板块优先于旧 query 参数。
  const both = resolveAdminRoute({ section: 'classes', legacyTab: 'major', fallbackTab: 'overview' });
  assert.equal(both.tab, 'classes');
  assert.equal(both.path, '/admin/classes');
});

test('adminSectionUrl keeps only the flags that must survive a section switch', () => {
  assert.equal(
    adminSectionUrl({ tab: 'classes', search: '?allowIncomplete=1&tab=users&batch=1' }),
    '/admin/classes?allowIncomplete=1',
  );
  assert.equal(adminSectionUrl({ tab: 'overview', search: '' }), '/admin/overview');
  assert.equal(adminSectionUrl({ tab: 'users', search: '', extra: { account: '1' } }), '/admin/users?account=1');
  assert.equal(
    adminSectionUrl({ tab: 'users', search: '?alerts=1', extra: { batch: '1' } }),
    '/admin/users?alerts=1&batch=1',
  );
  assert.equal(
    adminSectionUrl({ tab: 'exam', view: 'editor', search: '?initialize=1' }),
    '/admin/exam/editor?initialize=1',
  );
});

test('firstPermittedAdminTab follows the nav order and falls back', () => {
  assert.equal(
    firstPermittedAdminTab(() => true, 'classes'),
    'overview',
  );
  assert.equal(
    firstPermittedAdminTab((permission) => permission === 'school.read', 'overview'),
    'classes',
  );
  assert.equal(
    firstPermittedAdminTab((permission) => permission === 'device.read' || permission === 'user.read', 'overview'),
    'devices',
  );
  assert.equal(
    firstPermittedAdminTab(() => false, 'classes'),
    'classes',
  );
});
