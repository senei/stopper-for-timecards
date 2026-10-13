# Reviewer — AI code review (M5L2 / M5L3)

Agent, który ocenia diff pull requesta w sześciu kryteriach, wydaje wiążący werdykt `pass`/`fail`
i zatrzymuje merge w CI. Ten plik wskazuje, gdzie w repozytorium leży każdy element zadania.

## Mapa zadań

| Zadanie z kursu                       | Gdzie to jest                                                                                                                                                                                                                                  |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Sześć kryteriów dobrego review     | [review-schema.ts](src/review-schema.ts) (opisy skal 1–10) i [system.ts](src/prompts/system.ts). Źródło: `.claude/prompts/m5l3-requirements.md`, zapisane w [requirements.md](../context/archive/2026-10-12-ci-cd-code-review/requirements.md) |
| 2. Wymuszona struktura odpowiedzi     | [review-schema.ts](src/review-schema.ts): schemat zod z 6 ocenami, `verdict` i `summary`. Logika modelu w [reviewer.ts](src/reviewer.ts)                                                                                                       |
| 3. Evale promptfoo, porównanie modeli | [promptfooconfig.yaml](promptfooconfig.yaml), [provider.ts](src/evals/provider.ts), fixture [react19-migration.diff](evals/fixtures/react19-migration.diff), wyniki [results.json](evals/results.json)                                         |
| 4. Pipeline na PR (M5L3)              | [review.yml](../.github/workflows/review.yml), akcja [action.yml](../.github/actions/ai-reviewer/action.yml)                                                                                                                                   |
| Dowody 10xChampion                    | [screenshots/m5l3/](../screenshots/m5l3)                                                                                                                                                                                                       |

## Kryteria i werdykt

Sześć ocen w skali 1–10:

1. poprawność implementacji (`implementationCorrectness`),
2. idiomatyczność (`idiomaticity`),
3. złożoność (`complexity`),
4. pokrycie testami proporcjonalne do ryzyka (`testRiskCoverage`),
5. dokumentacja (`documentation`),
6. bezpieczeństwo (`securitySafety`).

Do tego `verdict` (`pass` lub `fail`, czyta go bramka w CI) i `summary` (Markdown, trafia do komentarza na PR).
Zakres 1–10 jest opisany w `describe`, bo structured output Anthropic odrzuca `minimum`/`maximum` na liczbach.

## Uruchomienie lokalne

```bash
cd reviewer
npm install
# reviewer/.env: OPENROUTER_API_KEY=...  REVIEWER_MODEL=z-ai/glm-5.3
git diff main | npm run review      # JSON z oceną na stdout
npm test                            # testy offline, bez modelu
```

Kody wyjścia i limity (np. diff powyżej `MAX_DIFF_CHARS` kończy się kodem 3 bez wywołania modelu) są w [limits.ts](src/limits.ts).

## Evale (porównanie modeli)

```bash
npm run eval --prefix reviewer      # zużywa kredyty OpenRouter
```

Jeden diff z trzema celowo wprowadzonymi wadami (React 16 → 19: `ReactDOM.render`, wyciek subskrypcji w efekcie,
`dangerouslySetInnerHTML`), trzy modele obok siebie. Trzy asercje na każdy model: poprawny JSON, rubryka LLM
(czy review nazywa wszystkie trzy wady) i `verdict === "fail"`.

| Model                          | Wynik | Czas       | Tokeny (wej. / wyj.) | Koszt 1 review | Koszt 1000 review |
| ------------------------------ | ----- | ---------- | -------------------- | -------------- | ----------------- |
| `openai/gpt-5.6-luna`          | pass  | ok. 4,9 s  | 1568 / 356           | ok. $0,00074   | ok. $0,74         |
| `deepseek/deepseek-v4.1-flash` | pass  | ok. 6,6 s  | 917 / 1257           | ok. $0,00089   | ok. $0,89         |
| `z-ai/glm-5.3`                 | pass  | ok. 26,8 s | 854 / 2980           | ok. $0,0144    | ok. $14,37        |

Koszt jest przeliczony ręcznie, bo pole kosztu w `results.json` wynosi 0 (OpenRouter nie zwraca ceny przez tego
providera): tokeny z `results.json` razy cena za token z `https://openrouter.ai/api/v1/models` (stan z 2026-10-13).
Ceny za 1M tokenów (wej. / wyj.): luna $0,20 / $1,20, deepseek $0,15 / $0,60 (w godzinach szczytu do 2x),
glm $0,079 / $4,80. To pojedynczy przebieg na jednym diffie, więc liczby są rzędem wielkości, nie benchmarkiem.
Tokeny wejściowe różnią się między modelami, bo każdy ma inny tokenizer.

Domyślny model w CI to `z-ai/glm-5.3` (`model` w [action.yml](../.github/actions/ai-reviewer/action.yml)).

Zestaw służy też jako bramka regresji: uruchom go po każdej zmianie [system.ts](src/prompts/system.ts)
lub schematu.

## Pipeline w GitHub Actions

- Wyzwalacz: PR do `main` (`opened`, `synchronize`, `reopened`) i etykieta `ai-cr:review` (ponowny przebieg).
- Jeden komentarz na PR, edytowany przy każdym przebiegu, plus etykieta `ai-cr:passed` lub `ai-cr:failed`.
- Job `review` kończy się błędem przy werdykcie `fail` i przy diffie powyżej limitu (bez wywołania modelu).
- PR-y z forków są pomijane (sekrety nie są do nich dostępne).
- Wymagany sekret repozytorium: `OPENROUTER_API_KEY`.
- Branch protection na `main` wymaga checku `review`. Administrator może ją ominąć (`enforce_admins: false`).

## Dowody (zrzuty)

| Kategoria                | Plik                                                                                                 |
| ------------------------ | ---------------------------------------------------------------------------------------------------- |
| Widok pipeline'u z jobem | [02-pipeline-ai-code-review.png](../screenshots/m5l3/02-pipeline-ai-code-review.png)                 |
| Logi joba                | [03-job-logs-full.jpeg](../screenshots/m5l3/03-job-logs-full.jpeg)                                   |
| Komentarz LLM na PR      | [01-pr-18-review-comment-and-checks.png](../screenshots/m5l3/01-pr-18-review-comment-and-checks.png) |

Zrzuty pochodzą z throwaway PR #18 (zamknięty), który zawierał celowo wadliwy kod i potwierdził, że
failujący check `review` blokuje merge.

## Historia zmian

- Plan evali: [code-review-evals](../context/archive/2026-10-12-code-review-evals/plan.md)
- Plan pipeline'u: [ci-cd-code-review](../context/archive/2026-10-12-ci-cd-code-review/plan.md)
- Agent: [tool-loop-agent](../context/archive/2026-10-12-tool-loop-agent/plan.md)
