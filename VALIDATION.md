# Проверки 0.3.1

Выполнено локально на Python 3.13.5, Node.js 22.16.0, OpenSCAD 2021.01 и Chromium.

| Набор | Пройдено | Что проверено |
|---|---:|---|
| `npm test` | 41 / 41 | Старая геометрия, STL/ZIP/JSON, импорт, качество дуг, сохранение ручных сегментов, настройки |
| `python -m unittest discover -s tests -p 'test_*.py' -v` | 49 / 49 | STL, API, CSG, каналы, отмена, топология, численные пересечения, сравнение с аналитикой |
| `tests/browser_test.py` | 25 / 25 | Регрессия параметрической вазы |
| `tests/browser_stl_test.py` | 21 / 21 | STL → настоящий OpenSCAD → сцена → экспорт; проект и каналы |
| `tests/browser_audit_test.py` | 18 / 18 | Детализация, скрытые поля, атомарный импорт, двойная отправка, поздние ответы, Escape, сохранение до CAD, рёбра |

Итого **154 проверки**. `npm run example` создал 15 замкнутых STL исходной оснастки.
Аудит, примеры дефектов и измеренные объёмы: [docs/AUDIT-0.3.1.md](docs/AUDIT-0.3.1.md).

В локальной среде Chromium не разрешает переход к loopback. Браузерные тесты
использовали реальные исходники через Blob-модули; STL и аудит — ограниченный
тестовый HTTP-мост к настоящему Python-серверу и OpenSCAD. CAD-результаты не
подменялись. Отрисовка — **CPU / Canvas**. GitHub CI отдельно выполняет обычную
HTTP-навигацию. Не следует отождествлять её результат с локальной проверкой.

Десктоп и мобильная компоновка проверены на 1500/1440 и 390 пикселях. Скриншоты
получены из приложения. Аппаратный WebGL, Safari/Firefox, физические сенсорные
устройства и печать не испытывались. Численная проверка сетки имеет допуск и
ресурсный предел, не доказывает извлекаемость и не использует точные предикаты.

```bash
python3 scripts/make-examples.py
npm test
python3 -m unittest discover -s tests -p 'test_*.py' -v
npm run example
python3 -m pip install playwright==1.57.0
python3 -m playwright install chromium
python3 serve.py --no-browser
# Другой терминал:
VMG_TEST_URL=http://127.0.0.1:8765 python3 tests/browser_test.py
VMG_TEST_URL=http://127.0.0.1:8765 python3 tests/browser_stl_test.py
VMG_TEST_URL=http://127.0.0.1:8765 python3 tests/browser_audit_test.py
```

Для среды с ограниченной навигацией: `VMG_TEST_BRIDGE=1` у STL/аудит-теста.
В пользовательский интерфейс мост не включается. `VMG_CHROMIUM` задаёт путь к
браузеру, `VMG_SCREENSHOT_DIR` — папку результатов.
