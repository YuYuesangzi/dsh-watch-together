// DSH 设置页「陪看」：状态 + 开始/结束/静音/取消静音
window.__ModuleLoader__.load({
  id: '@local/dsh-watch-together',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    function Panel() {
      const [state, setState] = React.useState(null);
      const [msg, setMsg] = React.useState('');
      const load = React.useCallback(async () => {
        try {
          const r = await fetch('/watch-together/state', { headers: { accept: 'application/json' } });
          setState(await r.json());
        } catch {
          setState({ ok: false });
        }
      }, []);
      React.useEffect(() => {
        load();
        const t = setInterval(load, 2000);
        return () => clearInterval(t);
      }, [load]);

      const cmd = async (c) => {
        setMsg('…');
        try {
          const r = await fetch('/watch-together/cmd', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ cmd: c }),
          });
          const j = await r.json();
          setMsg(j.ok ? '已执行：' + c : '失败：' + (j.error || ''));
          load();
        } catch {
          setMsg('请求失败');
        }
      };

      const btn = (label, c, ghost) => h('button', {
        key: c,
        onClick: () => cmd(c),
        style: {
          marginRight: 8,
          padding: '6px 14px',
          borderRadius: 8,
          border: ghost ? '1px solid var(--dsh-border, #2c3444)' : 'none',
          background: ghost ? 'transparent' : 'var(--dsh-accent, #2b4a7d)',
          color: 'inherit',
          cursor: 'pointer',
          font: '13px system-ui',
        },
      }, label);

      const active = !!(state && state.active);
      const status = active
        ? h('div', null,
            h('b', null, state.title || ''),
            h('div', { style: { opacity: 0.75 } },
              state.clock + ' / ' + state.duration +
              (state.paused ? ' · 暂停中' : '') +
              (state.auto ? ' · 自动吐槽开' : ' · 自动吐槽关') +
              (state.edge ? '' : ' · 找不到页面')))
        : h('div', { style: { opacity: 0.7 } }, '现在没有在陪看');

      return h('div', { style: { padding: '4px 2px', font: '13px system-ui', lineHeight: 1.7 } },
        h('div', { style: { opacity: 0.8, marginBottom: 8 } },
          '在「陪看模式Edge」里打开视频后点开始；她的话会以半透明小字出现在画面上，可拖动、全屏也在。'),
        h('div', {
          style: {
            padding: '8px 12px', borderRadius: 10, marginBottom: 10,
            background: 'var(--dsh-surface, #161922)', border: '1px solid var(--dsh-border, #262d3a)',
          },
        }, status),
        h('div', null,
          btn(active ? '重新开始' : '开始陪看', 'start'),
          btn('结束', 'stop', true),
          btn('静音小字', 'mute', true),
          btn('取消静音', 'unmute', true)),
        msg ? h('div', { style: { opacity: 0.7, marginTop: 8 } }, msg) : null);
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        ctx.slots.inject('settings.section', () => ctx.slots.register({
          name: 'settings.section',
          id: 'watch-together',
          order: 60,
          label: '陪看',
        }, Panel));
      },
    };
  },
});
