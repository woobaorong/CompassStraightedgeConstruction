// 悬浮提示 (tooltip): 鼠标悬停超过 DELAY 毫秒才显示文字说明。
// 覆盖右上角工具 (.tool-btn) 与左下角开关 (.toggle-wrap)。
// 初始化时把元素原生 title 迁移到 data-tip 并删除 title，
// 以彻底抑制浏览器自带提示 (原生约 1s 弹出，不满足 2s 要求)。
const Tooltip = (function () {
    'use strict';

    const DELAY = 1300;          // 显示延迟 (ms)
    const GAP = 8;               // 气泡与元素的间距 (px)
    const MARGIN = 8;            // 距视口边缘最小留白 (px)
    const SELECTOR = '.tool-btn[title], .toggle-wrap[title]';

    let tipEl = null;            // 单例气泡 DOM
    let timer = null;            // 延迟显示定时器

    function ensureEl() {
        if (!tipEl) {
            tipEl = document.createElement('div');
            tipEl.className = 'custom-tooltip';
            tipEl.setAttribute('role', 'tooltip');
            document.body.appendChild(tipEl);
        }
        return tipEl;
    }

    // 依据元素矩形定位气泡: 优先下方，下方放不下则上方；水平居中并夹在视口内
    function place(el) {
        const r = el.getBoundingClientRect();
        const tw = tipEl.offsetWidth, th = tipEl.offsetHeight;
        let top = r.bottom + GAP;
        if (top + th > window.innerHeight - MARGIN) top = r.top - GAP - th;   // 翻转到上方
        if (top < MARGIN) top = MARGIN;
        let left = r.left + r.width / 2 - tw / 2;
        left = Math.max(MARGIN, Math.min(left, window.innerWidth - tw - MARGIN));
        tipEl.style.top = top + 'px';
        tipEl.style.left = left + 'px';
    }

    function show(el) {
        const text = el.getAttribute('data-tip');
        if (!text) return;
        const t = ensureEl();
        t.textContent = text;
        t.classList.add('show');
        place(el);
    }

    function hide() {
        if (timer) { clearTimeout(timer); timer = null; }
        if (tipEl) tipEl.classList.remove('show');
    }

    function onEnter(e) {
        const el = e.currentTarget;
        if (!el.getAttribute('data-tip')) return;
        hide();
        timer = setTimeout(() => { timer = null; show(el); }, DELAY);
    }

    function bind(el) {
        el.addEventListener('pointerenter', onEnter);
        el.addEventListener('pointerleave', hide);
    }

    function init() {
        document.querySelectorAll(SELECTOR).forEach(el => {
            const text = el.getAttribute('title');
            if (text) {
                el.setAttribute('data-tip', text);
                el.removeAttribute('title');   // 抑制原生提示
            }
            bind(el);
        });
        // 滚动 / 缩放时隐藏，避免气泡与元素错位
        window.addEventListener('scroll', hide, true);
        window.addEventListener('resize', hide);
    }

    // DOM 就绪后初始化 (脚本置于 body 末尾，通常已就绪)
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    return { init };
})();
