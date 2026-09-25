# Frame regression

`frame-regression.js` запускается в странице Frame и проверяет реальные production API, генераторы и renderer. Никаких npm-зависимостей не нужно.

Инструкции для агента встроены в `index.html`: `frameAI.getInstructions()` или текст элемента `#frame-ai-instructions`. Список методов — `frameAI.help()`.

**Тесты заменяют текущую сцену. Запускайте в отдельной вкладке без пользовательской работы.**

Запустите локальный сервер из корня репозитория:

```powershell
python -m http.server 8765 --bind 127.0.0.1
```

Откройте `http://127.0.0.1:8765`, затем выполните в консоли этой страницы:

```js
await new Promise((resolve,reject) => {
  const s=document.createElement('script');
  s.src='/tests/frame-regression.js';
  s.onload=resolve; s.onerror=reject; document.head.appendChild(s);
});
const result = await runFrameRegression(frameAI, {render:true});
console.table(result.results.map(({name,ok,ms,error})=>({name,ok,ms,error})));
console.log(result.passed, result.failed);
```

`render:true` включает отдельную проверку WebGPU PNG и экспортируемого кадра; без неё запускаются 63 сценария, с ней — 64. Обычно проверка занимает несколько секунд плюс компиляция WebGPU-шейдеров.

Матрица: 7 единиц; пустая сетка и объект за камерой; 4 камеры; orbit/pan/dolly/look/wheel; 5 примитивов в mm/µm/nm; параметры, rescale, undo/redo; анимация и native roundtrip; 3 Boolean × 2 единицы; 6 генераторов × 5 режимов × single/quad; 7 внешних форматов; очистка ресурсов; материалы; независимость библиотечных буферов; extrude/bevel; регенерация после удаления; компактный осмотр тяжёлого меша; batch и JSON FIFO; обновление HUD.

## Большая сцена

Файл `Frame_Campus_1000_5M.hash` в корне — 1000 объектов, примерно 5 млн треугольников. В той же одноразовой вкладке:

```js
await frameAI.importSceneData('hash',
  Array.from(new Uint8Array(await (await fetch('/Frame_Campus_1000_5M.hash')).arrayBuffer())));
frameAI.clearSelection();
frameAI.setView('single',0);
const results=[];
for(const mode of ['solid','wire','solid+wire','spline-cage','solid+spline-cage']) {
  frameAI.setShading(mode,0);
  for(const enabled of [false,true]) {
    frameAI.setPerformanceOptions({libraryBatching:enabled,surfaceMerging:enabled});
    await frameAI.waitForIdle();
    const b=await frameAI.benchmarkViewport({samples:30,warmup:5});
    results.push({mode,enabled,ms:b.medianMs,calls:b.diagnostics.renderer.calls});
  }
}
console.table(results);
frameAI.setPerformanceOptions({libraryBatching:true,surfaceMerging:true});
```

Сравнивайте в одной вкладке, при одинаковых камере, размере окна и настройках. Эти переключатели сравнивают два новых способа объединения; улучшения буферов, материалов и матриц активны в обоих вариантах. Поэтому это не сравнение всей r84 с исходной r83. Незначительные различия пикселей в wire возможны из-за порядка рисования и точности GPU; качество геометрии не снижается.
