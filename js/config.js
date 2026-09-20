/**
 * 全局配置与常量 — 所有可调参数集中于此
 */
const Config = Object.freeze({
    // 画布尺寸 (px)
    CANVAS_WIDTH: 900,
    CANVAS_HEIGHT: 650,

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
        snapSuffix: '吸附'
    }),

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
        snap: Object.freeze({
            intersection: { color: '#f97316', fill: 'rgba(249, 115, 22, 0.3)' },
            endpoint:     { color: '#16a34a', fill: 'rgba(22, 163, 74, 0.3)' },
            center:       { color: '#b91c1c', fill: 'rgba(185, 28, 28, 0.3)' },
            circle:       { color: '#7c3aed', fill: 'rgba(124, 58, 237, 0.3)' },
            line:         { color: '#ec4899', fill: 'rgba(236, 72, 153, 0.3)' },
            default:      { color: '#4c7aff', fill: 'rgba(76, 122, 255, 0.3)' }
        })
    }),

    // 吸附类型优先级 (数值越大越优先)
    PRIORITY: Object.freeze({
        intersection: 100,
        endpoint: 80,
        center: 80,
        circle: 30,
        line: 20
    })
});
