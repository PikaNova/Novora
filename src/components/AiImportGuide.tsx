import React, { useMemo, useState } from 'react';
import { Clipboard, Sparkles } from 'lucide-react';
import { notify } from '../services/notify';

type Props = { kind: 'major' | 'weekly'; context: string };

export default function AiImportGuide({ kind, context }: Props) {
  const [open, setOpen] = useState(false);
  const prompt = useMemo(() => kind === 'major'
    ? `你是考试排班表识别助手。请读取我接下来上传的排班表照片，只输出一个可被 JSON.parse 解析的 JSON 对象，不要输出 Markdown、解释或代码围栏。\n场景：${context}\n格式：{"title":"考试名称","items":[{"name":"科目","startTime":"YYYY-MM-DDTHH:mm:ss","endTime":"YYYY-MM-DDTHH:mm:ss","enabled":true}]}\n要求：使用照片中的实际日期和 24 小时时间；按开始时间升序；无法确认的内容不要猜测，改为在 JSON 最外层增加 warnings 字符串数组；每项结束时间必须晚于开始时间。`
    : `你是学校周测排班表识别助手。请读取我接下来上传的课程或周测安排照片，只输出一个可被 JSON.parse 解析的 JSON 对象，不要输出 Markdown、解释或代码围栏。\n场景：${context}\n格式：{"items":[{"name":"周测名称","weekday":1,"startTime":"HH:mm","endTime":"HH:mm","enabled":true,"weekType":"all"}]}\n要求：weekday 使用 1 至 7 表示周一至周日；按星期和开始时间升序；A/B 周分别使用 a 或 b，每周都进行使用 all；无法确认的内容不要猜测，改为在 JSON 最外层增加 warnings 字符串数组。`, [context, kind]);
  const copy = async () => {
    try { await navigator.clipboard.writeText(prompt); notify('success', '提示词已复制，可粘贴到任意支持图片的 AI 软件。'); }
    catch { notify('error', '复制失败，请手动选择提示词文本。'); }
  };
  return <section className="ai-import-guide"><button type="button" className="admin-btn" onClick={() => setOpen(value => !value)}><Sparkles size={15} />{open ? '收起 AI 提示词' : '生成识图提示词'}</button>{open && <div><p>本项目不会连接 AI。复制提示词，在任意 AI 软件中上传排表照片，再将返回的 JSON 粘贴到下方。</p><textarea className="admin-textarea" rows={8} readOnly value={prompt} /><button type="button" className="admin-btn admin-btn--primary" onClick={() => void copy()}><Clipboard size={15} />复制提示词</button></div>}</section>;
}
