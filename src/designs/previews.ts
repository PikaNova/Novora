/**
 * 各展示设计的样例缩略图（内联 SVG data URI，无需额外二进制资源）。
 * 用于切换窗中直观预览每个方案的风格。
 */

const svg = (inner: string): string =>
  `data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 160 100'>${inner}</svg>`
  )}`;

// 01 深色指挥舱
const commandDeck = svg(
  `<rect width='160' height='100' fill='#0e1524'/>` +
  `<rect x='0' y='0' width='160' height='16' fill='#131d31'/>` +
  `<circle cx='10' cy='8' r='3' fill='#4f8cff'/><rect x='120' y='5' width='30' height='6' rx='3' fill='#22406e'/>` +
  `<text x='80' y='50' fill='#eaf1ff' font-size='26' font-family='Arial' font-weight='bold' text-anchor='middle'>08:30</text>` +
  `<rect x='24' y='60' width='112' height='6' rx='3' fill='#1d2b45'/><rect x='24' y='60' width='64' height='6' rx='3' fill='#4f8cff'/>` +
  `<rect x='24' y='74' width='32' height='18' rx='3' fill='#16223a'/><rect x='64' y='74' width='32' height='18' rx='3' fill='#16223a'/><rect x='104' y='74' width='32' height='18' rx='3' fill='#16223a'/>`
);

// 02 清爽聚焦
const cleanFocus = svg(
  `<rect width='160' height='100' fill='#eef5fc'/>` +
  `<rect x='8' y='8' width='144' height='84' rx='10' fill='#ffffff' stroke='#d8e5f3'/>` +
  `<rect x='108' y='16' width='34' height='7' rx='3.5' fill='#e6f4ff'/>` +
  `<text x='80' y='55' fill='#146eb4' font-size='26' font-family='Arial' font-weight='bold' text-anchor='middle'>08:30</text>` +
  `<g fill='#1681d4'>` +
  `<rect x='30' y='68' width='10' height='9' rx='2'/><rect x='44' y='68' width='10' height='9' rx='2'/><rect x='58' y='68' width='10' height='9' rx='2'/><rect x='72' y='68' width='10' height='9' rx='2' fill='#cfe6fb'/><rect x='86' y='68' width='10' height='9' rx='2' fill='#cfe6fb'/><rect x='100' y='68' width='10' height='9' rx='2' fill='#cfe6fb'/><rect x='114' y='68' width='10' height='9' rx='2' fill='#cfe6fb'/>` +
  `</g>`
);

// 03 校园黑板
const blackboard = svg(
  `<rect width='160' height='100' fill='#16352a'/>` +
  `<rect x='5' y='5' width='150' height='90' rx='6' fill='none' stroke='#3c6b53' stroke-width='2'/>` +
  `<text x='80' y='30' fill='#f3ecd8' font-size='16' font-family='Arial' font-weight='bold' text-anchor='middle'>08:30:00</text>` +
  `<circle cx='80' cy='64' r='20' fill='none' stroke='#284d3c' stroke-width='6'/>` +
  `<circle cx='80' cy='64' r='20' fill='none' stroke='#f2c14e' stroke-width='6' stroke-dasharray='80 46' transform='rotate(-90 80 64)'/>` +
  `<text x='80' y='68' fill='#f3ecd8' font-size='11' font-family='Arial' text-anchor='middle'>63%</text>`
);

// 04 高对比应急
const emergency = svg(
  `<rect width='160' height='100' fill='#050505'/>` +
  `<rect x='0' y='0' width='160' height='18' fill='#c0392b'/>` +
  `<text x='80' y='13' fill='#fff' font-size='9' font-family='Arial' font-weight='bold' text-anchor='middle'>考试进行中</text>` +
  `<text x='80' y='58' fill='#ffd21f' font-size='30' font-family='Arial' font-weight='bold' text-anchor='middle'>08:30</text>` +
  `<rect x='16' y='70' width='128' height='7' rx='3.5' fill='#1c1c1c'/><rect x='16' y='70' width='80' height='7' rx='3.5' fill='#ffd21f'/>` +
  `<rect x='16' y='83' width='40' height='11' rx='2' fill='#141414'/><rect x='60' y='83' width='40' height='11' rx='2' fill='#141414'/><rect x='104' y='83' width='40' height='11' rx='2' fill='#141414'/>`
);

// 05 编辑排版
const editorial = svg(
  `<rect width='160' height='100' fill='#f2eee5'/>` +
  `<rect x='0' y='0' width='10' height='100' fill='#d8422b'/>` +
  `<rect x='118' y='0' width='42' height='100' fill='#183a37'/>` +
  `<rect x='22' y='12' width='40' height='6' rx='2' fill='#bbb4a8'/>` +
  `<text x='22' y='60' fill='#183a37' font-size='30' font-family='Georgia' font-weight='bold'>08</text>` +
  `<text x='68' y='60' fill='#d8422b' font-size='22' font-family='Georgia' font-weight='bold'>:30</text>` +
  `<rect x='22' y='70' width='84' height='2' fill='#bbb4a8'/>` +
  `<rect x='126' y='20' width='26' height='6' rx='2' fill='#3f6d5f'/><rect x='126' y='42' width='30' height='10' rx='2' fill='#a9c4b9'/><rect x='126' y='64' width='22' height='8' rx='2' fill='#3f6d5f'/>`
);


const lightThumb=(bg:string,accent:string,kind:string)=>svg(`<rect width='160' height='100' fill='${bg}'/>${kind==='orbit'?`<circle cx='80' cy='55' r='24' fill='none' stroke='${accent}' stroke-width='8'/><text x='80' y='59' fill='#183a52' font-size='12' text-anchor='middle'>58%</text>`:kind==='ice'?`<rect x='0' width='38' height='100' fill='#dff0ff'/><rect x='122' width='38' height='100' fill='#eaf5ff'/><text x='80' y='57' fill='#153a5b' font-size='25' font-family='Arial' font-weight='bold' text-anchor='middle'>08:30</text>`:kind==='peach'?`<rect x='0' width='28' height='100' fill='#ffcfbd'/><text x='42' y='55' fill='#313d50' font-size='27' font-family='Arial' font-weight='bold'>08:30</text><rect x='42' y='69' width='96' height='8' rx='4' fill='${accent}'/>`:`<text x='22' y='57' fill='#183a52' font-size='28' font-family='Arial' font-weight='bold'>08:30</text><rect x='22' y='70' width='88' height='8' rx='4' fill='${accent}'/><rect x='116' y='30' width='28' height='28' rx='6' fill='${accent}' opacity='.55'/>`}`);
const neonQuartz=svg(`<rect width='160' height='100' fill='#0c0b1c'/><text x='80' y='57' fill='#fff' font-size='27' font-family='Arial' font-weight='bold' text-anchor='middle'>08:30</text><rect x='24' y='70' width='112' height='5' rx='3' fill='#35e5dc'/><circle cx='140' cy='12' r='22' fill='#221d55'/>`);
const cinemaRedline=svg(`<rect width='160' height='100' fill='#101113'/><rect width='160' height='5' fill='#e84a42'/><rect y='95' width='160' height='5' fill='#e84a42'/><text x='18' y='57' fill='#f8f8f4' font-size='27' font-family='Arial' font-weight='bold'>08:30</text><rect x='18' y='67' width='110' height='5' rx='3' fill='#e84a42'/>`);
const sunriseSchedule=lightThumb('#f6fbff','#2b9bcb','standard'); const paletteDashboard=lightThumb('#fffaf3','#f29d38','standard'); const orbitFocus=lightThumb('#edfaf6','#52c5ad','orbit'); const peachTaskBoard=lightThumb('#fff5f0','#f79475','peach'); const posterGrid=lightThumb('#f8f5ec','#f9c744','standard'); const iceColumns=lightThumb('#f4f9ff','#388bca','ice');

export const DESIGN_THUMBS: Record<string, string> = {
  'command-deck': commandDeck,
  'clean-focus': cleanFocus,
  'blackboard': blackboard,
  'emergency': emergency,
  'editorial': editorial,
  'neon-quartz': neonQuartz, 'cinema-redline': cinemaRedline,
  'sunrise-schedule': sunriseSchedule, 'palette-dashboard': paletteDashboard, 'orbit-focus': orbitFocus, 'peach-task-board': peachTaskBoard, 'poster-grid': posterGrid, 'ice-columns': iceColumns,
};
