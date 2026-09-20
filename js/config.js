/**
 * 全局配置与常量 — 所有可调参数集中于此
 */
const Config = Object.freeze({
    // HiDPI 渲染上限 — devicePixelRatio 超过该值时按该值渲染，避免性能浪费
    MAX_DPR: 2,

    // 射线/直线的有效延伸长度 (世界坐标) — 用大有限数代替 Infinity，保证可 JSON 序列化
    LINE_EXTENT: 1e7,

    // 弧多边形化采样的最大屏幕像素步长 (填充用)
    ARC_SAMPLE_PX: 4,

    // 视图缩放范围
    MIN_SCALE: 0.15,
    MAX_SCALE: 8,

    // 吸附距离 (屏幕像素)
    SNAP_DIST_SCREEN: 16,

    // 最小图形尺寸 (屏幕像素)，小于该值视为误触、不创建
    MIN_SHAPE_SCREEN: 3,

    // 网格基准间距 (世界坐标)
    GRID_BASE_SPACING: 50,

    // 历史记录上限
    MAX_HISTORY: 50,

    // 状态提示文案
    TEXT: Object.freeze({
        statusCompass: '圆规: 点击圆心 → 拖动定半径',
        statusRuler: '直尺: 点击起点 → 点击终点',
        statusEraser: '橡皮: 单击/拖动擦除交点或端点之间的整段',
        statusFill: '填充: 点击封闭区域填色 · 色板可换颜色',
        fillFail: '未找到封闭区域，无法填充',
        snapSuffix: '吸附'
    }),

    // 油漆桶预设色板 (与 index.html 色板按钮一一对应)
    FILL_COLORS: Object.freeze([
        '#ef4444', '#f97316', '#eab308', '#22c55e',
        '#06b6d4', '#3b82f6', '#a855f7', '#ec4899'
    ]),

    // 橡皮擦光圈半径 (屏幕像素)
    ERASER_RADIUS_SCREEN: 12,

    // 擦除采样合并间距 (屏幕像素)：同笔画两次经过的参数区间间隔小于该值视为连续
    ERASER_MERGE_GAP_PX: 40,

    // 单击判定阈值 (屏幕像素位移)：小于该值视为单击 → 删除整条曲线
    CLICK_DIST_SCREEN: 4,

    // 配色方案
    COLORS: Object.freeze({
        line: '#1e3a8a',                       // 线段
        lineEndpoint: '#16a34a',               // 线段端点
        circle: '#b91c1c',                     // 圆 / 圆心
        circleRadiusLine: 'rgba(185, 28, 28, 0.2)',  // 半径虚线
        intersection: 'rgba(249, 115, 22, 0.6)',     // 交点标记
        preview: '#4c7aff',                    // 预览图形
        previewLine: 'rgba(76, 122, 255, 0.5)',      // 预览辅助线
        grid: '#f0f0f0',                       // 网格
        axis: '#e0e0e0',                       // 坐标轴
        startPoint: '#f97316',                 // 绘制起点标记
        eraserHighlight: 'rgba(255, 85, 85, 0.4)',   // 橡皮擦除区间高亮
        eraserRing: 'rgba(220, 60, 60, 0.9)',        // 橡皮光圈
        snap: Object.freeze({
            intersection: { color: '#f97316', fill: 'rgba(249, 115, 22, 0.3)' },
            endpoint:     { color: '#16a34a', fill: 'rgba(22, 163, 74, 0.3)' },
            center:       { color: '#b91c1c', fill: 'rgba(185, 28, 28, 0.3)' },
            circle:       { color: '#7c3aed', fill: 'rgba(124, 58, 237, 0.3)' },
            line:         { color: '#ec4899', fill: 'rgba(236, 72, 153, 0.3)' },
            axis:         { color: '#0d9488', fill: 'rgba(13, 148, 136, 0.3)' },
            default:      { color: '#4c7aff', fill: 'rgba(76, 122, 255, 0.3)' }
        })
    }),

    // 吸附类型优先级 (数值越大越优先)
    PRIORITY: Object.freeze({
        intersection: 100,
        axis: 90,
        endpoint: 80,
        center: 80,
        circle: 30,
        line: 20
    }),

    // 水平垂直吸附的角度容差 (弧度，0.5°)
    AXIS_SNAP_TOLERANCE: 0.5 * Math.PI / 180
});
