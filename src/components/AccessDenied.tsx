import React from 'react';
import { LockKeyhole } from 'lucide-react';

export default function AccessDenied({ moduleName, onBack }: { moduleName: string; onBack: () => void }) {
  return <main className="access-denied" role="alert"><LockKeyhole /><span>权限不足</span><h1>无法访问{moduleName}</h1><p>当前登录账户没有该模块的查看权限。账号仍保持登录，不会自动跳转或退出。</p><button onClick={onBack}>返回可用页面</button></main>;
}
