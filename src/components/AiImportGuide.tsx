import React, { useMemo, useState } from 'react';
import { Clipboard, Sparkles } from 'lucide-react';
import { notify } from '../services/notify';

type Props = { kind: 'major' | 'weekly'; context: string; targetTitle?: string; initiallyOpen?: boolean };

export default function AiImportGuide({ kind, context, targetTitle = '', initiallyOpen = false }: Props) {
  const [open, setOpen] = useState(initiallyOpen);
  const prompt = useMemo(() => kind === 'major'
    ? `你是考试安排表识别助手。请读取我接下来上传的考试安排表照片，并严格按以下规则输出。\n\n当前导入目标：${context}\n当前考试名称：${JSON.stringify(targetTitle || '考试名称')}\n\n只允许输出一个可被 JSON.parse 直接解析的 JSON 对象。禁止输出 Markdown、代码围栏、解释、提醒、注释或前后缀文字。\n根对象只能包含 title 和 items 两个字段，禁止增加 warnings、message、说明或其他字段。\n必须使用以下结构：{"title":${JSON.stringify(targetTitle || '考试名称')},"items":[{"name":"科目","startTime":"YYYY-MM-DDTHH:mm:ss","endTime":"YYYY-MM-DDTHH:mm:ss","enabled":true}]}\n\n强制约束：\n1. title 必须与上方“当前考试名称”逐字一致。即使图片中出现其他考试标题，也不得替换、改写或补充 title。\n2. 图片仅用于提取适用于当前导入目标的科目、日期、开始时间和结束时间；不要生成其他年级、其他场次或图片中不存在的项目。\n3. 使用图片中的实际日期和 24 小时时间，时间格式必须为 YYYY-MM-DDTHH:mm:ss，不得使用中文日期或时区后缀。\n4. items 中每个对象只能包含 name、startTime、endTime、enabled；enabled 固定为 true。\n5. 每项 endTime 必须晚于 startTime，并按 startTime 从早到晚排序。\n6. 无法确认的行直接省略，不得猜测，不得添加 warnings 或用额外文字说明。\n7. 如果没有任何可确认项目，仍输出 {"title":${JSON.stringify(targetTitle || '考试名称')},"items":[]}。\n8. 输出前自行检查 JSON 语法，必须使用英文双引号，不能有尾随逗号。`
    : `你是学校周测安排表识别助手。请读取我接下来上传的课程或周测安排照片，并严格按以下规则输出。\n\n当前导入目标：${context}\n\n只允许输出一个可被 JSON.parse 直接解析的 JSON 对象。禁止输出 Markdown、代码围栏、解释、提醒、注释或前后缀文字。\n根对象只能包含 items 字段，禁止增加 warnings、message、说明或其他字段。\n必须使用以下结构：{"items":[{"name":"周测名称","weekday":1,"startTime":"HH:mm","endTime":"HH:mm","enabled":true,"weekType":"all"}]}\n\n强制约束：\n1. 只提取适用于当前导入目标的周测，不要生成其他年级、其他班级或图片中不存在的项目。\n2. weekday 使用 1 至 7 表示周一至周日；时间使用 24 小时 HH:mm 格式。\n3. A 周使用 a，B 周使用 b，每周都进行使用 all；无法从图片确认时使用 all。\n4. items 中每个对象只能包含 name、weekday、startTime、endTime、enabled、weekType；enabled 固定为 true。\n5. 每项 endTime 必须晚于 startTime，并按 weekday、startTime 从小到大排序。\n6. 无法确认的行直接省略，不得猜测，不得添加 warnings 或用额外文字说明。\n7. 如果没有任何可确认项目，输出 {"items":[]}。\n8. 输出前自行检查 JSON 语法，必须使用英文双引号，不能有尾随逗号。`, [context, kind, targetTitle]);
  const copy = async () => {
    try { await navigator.clipboard.writeText(prompt); notify('success', '提示词已复制，可粘贴到任意支持图片的 AI 软件。'); }
    catch { notify('error', '复制失败，请手动选择提示词文本。'); }
  };
  return <section className="ai-import-guide"><button type="button" className="admin-btn" onClick={() => setOpen(value => !value)}><Sparkles size={15} />{open ? '收起 AI 提示词' : '生成识图提示词'}</button>{open && <div><p>本项目不会连接 AI。复制提示词，在任意 AI 软件中上传考试安排表照片，再将返回的 JSON 粘贴到下方。</p><textarea className="admin-textarea" rows={8} readOnly value={prompt} /><button type="button" className="admin-btn admin-btn--primary" onClick={() => void copy()}><Clipboard size={15} />复制提示词</button></div>}</section>;
}
