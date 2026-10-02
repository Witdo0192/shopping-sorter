// Ресурсы одной части UI: внешние события и временные узлы.
// listen безопасен и для отложенного вызова после destroy.
function createUiLifecycle() {
    let destroyed = false;
    const cleanups = new Set();
    function add(cleanup) {
        const release = () => { cleanups.delete(release); cleanup(); };
        if (destroyed) release();
        else cleanups.add(release);
        return release;
    }
    return {
        add,
        listen(target, type, handler, options) {
            target.addEventListener(type, handler, options);
            return add(() => target.removeEventListener(type, handler, options));
        },
        destroy() {
            if (destroyed) return;
            destroyed = true;
            for (const cleanup of [...cleanups]) cleanup();
        }
    };
}
