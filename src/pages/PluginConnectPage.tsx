import { useEffect, useState } from 'react';
import { CheckCircle2, Link2 } from 'lucide-react';
import BrandMark from '../components/BrandMark';
import { useSearchParams } from 'react-router-dom';
import { getCachedDeviceBinding, saveDeviceBinding } from '../services/classBinding';
import { confirmPluginPairing, fetchPluginPairInfo, type PluginPairInfo } from '../services/pluginPairing';
import '../styles/plugin-connect.css';
import ClassMultiPicker from '../components/ClassMultiPicker';

export default function PluginConnectPage() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const [info, setInfo] = useState<PluginPairInfo | null>(null);
  const [gradeId, setGradeId] = useState('');
  const [classId, setClassId] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [complete, setComplete] = useState(false);

  useEffect(() => {
    if (!token) { setError('配对链接无效，请返回 ClassIsland 重新连接。'); return; }
    fetchPluginPairInfo(token).then(value => {
      setInfo(value);
      const cached = getCachedDeviceBinding();
      if (cached && !cached.revoked && value.classes.some(item => item.id === cached.classId)) {
        setGradeId(cached.gradeId);
        setClassId(cached.classId);
      }
    }).catch(reason => setError(reason instanceof Error ? reason.message : '无法读取配对请求'));
  }, [token]);

  const selectedGrade = info?.grades.find(item => item.id === gradeId);
  const selectedClass = info?.classes.find(item => item.id === classId);
  const classOptions = (info?.classes ?? []).map(item => ({ id: item.id, gradeId: item.gradeId, gradeName: info?.grades.find(grade => grade.id === item.gradeId)?.name ?? '未知年级', className: item.name }));

  const confirm = async () => {
    if (!gradeId || !classId) { setError('请选择要绑定的年级和班级。'); return; }
    setSubmitting(true); setError('');
    try {
      await confirmPluginPairing(token, gradeId, classId);
      await saveDeviceBinding(gradeId, classId);
      setComplete(true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '班级绑定失败');
    } finally { setSubmitting(false); }
  };

  return <main className="plugin-connect">
    <BrandMark className="plugin-connect__brand" />
    <section className="plugin-connect__panel" aria-live="polite">
      {complete ? <>
        <CheckCircle2 className="plugin-connect__success" aria-hidden="true"/>
        <h1>ClassIsland 已连接</h1>
        <p>{selectedGrade?.name} {selectedClass?.name}</p>
        <button type="button" onClick={() => window.close()}>完成</button>
      </> : <>
        <div className="plugin-connect__icon"><Link2 aria-hidden="true"/></div>
        <h1>连接 ClassIsland</h1>
        <p>选择本机所在班级，考试安排将自动同步到 ClassIsland。</p>
        <label>年级<select value={gradeId} disabled={!info || submitting} onChange={event => { setGradeId(event.target.value); setClassId(''); }}>
          <option value="">请选择年级</option>{info?.grades.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select></label>
        <div className="plugin-connect__class-picker"><span>班级</span><ClassMultiPicker options={classOptions} gradeId={gradeId} selectedIds={classId ? [classId] : []} onChange={ids => setClassId(ids[0] || '')} disabled={!gradeId || submitting} single /></div>
        {error && <div className="plugin-connect__error" role="alert">{error}</div>}
        <button type="button" disabled={!info || !classId || submitting} onClick={() => void confirm()}>{submitting ? '正在连接…' : '确认连接'}</button>
      </>}
    </section>
  </main>;
}
