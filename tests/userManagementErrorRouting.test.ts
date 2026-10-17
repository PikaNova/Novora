import assert from 'node:assert/strict';
import test from 'node:test';
import { installTestModuleHooks } from './helpers/moduleHooks.js';

// 先装模块钩子（源码里有不带扩展名的相对导入），再动态引被测模块。
installTestModuleHooks();
const { AdminApiError } = await import('../src/services/adminUsers.js');
const { routeAdminApiError } = await import('../src/components/user-management/helpers.js');

/**
 * 回归背景：角色/用户向导保存失败时，错误被写进面板横幅，而横幅被弹窗遮罩盖住，
 * 用户看到的是「点了保存没反应、库里也没变、没有任何提示」。现在按 field 路由：
 * 有字段的落到字段上，没有字段（或 `_form`）的落到弹窗顶部。
 */

test('没有 field 的接口错误按表单级处理', () => {
  const routed = routeAdminApiError(new AdminApiError('不能创建权限高于当前账号的角色'));
  assert.equal(routed.field, '_form');
  assert.equal(routed.formLevel, true);
  assert.equal(routed.message, '不能创建权限高于当前账号的角色');
});

test('显式 _form 与显式字段分别落到表单级与字段级', () => {
  assert.equal(routeAdminApiError(new AdminApiError('至少选择一项权限', undefined, '_form')).formLevel, true);
  const fieldError = routeAdminApiError(new AdminApiError('用户名已存在', 'username'));
  assert.equal(fieldError.formLevel, false);
  assert.equal(fieldError.field, 'username');
});

test('非接口异常也按表单级处理，并带上回退文案', () => {
  const routed = routeAdminApiError(new Error('boom'), '保存失败');
  assert.equal(routed.field, '_form');
  assert.equal(routed.message, 'boom');
  assert.equal(routeAdminApiError(undefined, '保存失败').message, '保存失败');
});
