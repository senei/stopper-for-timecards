<!-- BEGIN @przeprogramowani/10x-cli -->

## Zestaw narzędzi AI 10xDevs - Moduł 3, Lekcja 3 (10xDevs 4.0 Hooks)

Traktuj hook jako **bramkę jakości uruchamianą przez harness dla agenta**, a nie skrypt, który według ciebie agent zauważy. Hooki działają poza modelem, więc przetrwają kompresję kontekstu i zapomniane instrukcje — ale tylko hook, którego sygnał faktycznie dociera do agenta, zamyka pętlę:

```
test-plan.md "Quality Gates" -> pick the moment per gate -> /10x-configure-hook -> prove with sample JSON -> watch the agent fix a deliberate error
```

### Router zadań - Od czego zacząć

| Umiejętność | Użyj jej, gdy |
| --- | --- |
| `/10x-configure-hook` | Przekształcasz bramki z `context/foundation/test-plan.md` w hooki agenta, naprawiasz hooki, które się uruchamiają, ale agent nigdy nie reaguje, albo audytujesz istniejącą konfigurację hooków. Wykrywa harness na podstawie repozytorium i zawiera datowane referencje dla każdego harness. |
| `/10x-test-plan --status` | Odczytujesz aktualne bramki i stan wdrożenia. Zmiana tego, które bramki istnieją, należy do Lekcji 1, nie tutaj. |
| `/10x-new` -> `/10x-research` -> `/10x-plan` -> `/10x-implement` | Hook ujawnił awarię, której agent nie może naprawić trywialną korektą (błędna logika biznesowa, niestabilna integracja). Otwórz zmianę zamiast zapętlać hook. |

### Cykl życia hooka

1. **Wyzwalacz** — zdarzenie w harness: narzędzie zakończyło edycję pliku, agent zaraz zakończy swoją turę.
2. **Matcher** — zawęża, na które wywołania narzędzi lub pliki reaguje hook. Nie każdy harness obsługuje matchery w ten sam sposób.
3. **Handler** — zwykle polecenie powłoki lub skrypt, który odczytuje ładunek zdarzenia jako JSON ze standardowego wejścia.
4. **Sygnał** — co zwraca hook. Kod wyjścia, stderr, stdout i pola JSON oznaczają różne rzeczy w różnych harness, a tylko jeden kanał na zdarzenie faktycznie dociera do agenta. **Kanał sygnału różni się zależnie od harness — przed napisaniem lub przeglądem hooka sprawdź referencje umiejętności.**

Hook, który się uruchamia, ale wysyła komunikat niewłaściwym kanałem, jest najczęstszą awarią: użytkownik widzi „hook error”, agent nie widzi niczego i kontynuuje.

### Momenty i warstwy

Im wolniejsza kontrola, tym rzadszy moment:

| Moment | Typowe kontrole | Dociera do agenta? |
| --- | --- | --- |
| Przy każdej edycji | Lint/formatowanie **tylko edytowanego pliku**; powiązane testy, jeśli są szybkie | Tak, w trakcie pracy |
| Koniec tury (Stop lub odpowiednik) | Lint + testy dla każdego pliku zmienionego w tej turze, typecheck całego projektu | Tak, zanim agent przekaże wynik |
| Pre-commit (git) | Lint + testy dla plików w stagingu; wyłapuje edycje wykonane bez agenta | Nie — blokuje commit |
| Pre-push (git) | Cięższe zestawy, e2e uruchamiane lokalnie | Nie — blokuje push |
| CI | Integracja, współdzielony stan, infrastruktura niedostępna lokalnie | Nie — feedback dla PR |

Lokalne warstwy nie zastępują CI; każda z nich oszczędza jeden cykl zwrotny CI. Zacznij od jednego hooka lint przy każdej edycji i jednego typechecka na koniec tury, a następnie dodawaj warstwy, gdy zobaczysz, co się przedostaje.

### Kontrakt

- Odczytaj bramki z sekcji „Quality Gates” w `context/foundation/test-plan.md` (według tytułu, nie numeru sekcji). Bramka, którą plan wyraźnie odkłada, pozostaje odłożona, chyba że użytkownik to zmieni — cytuj odroczenie, gdy pytasz.
- Hooki przy każdej edycji sprawdzają tylko edytowany plik. Nigdy nie uruchamiaj `--fix` ani lintera dla całego projektu przy każdej edycji.
- Hooki końca tury, które mogą odesłać agenta z powrotem, muszą zatrzymać się po jednej próbie ponowienia (flaga harness „already continued” lub odpowiednik), aby nienaprawialny błąd nie tworzył pętli.
- Hooki przy każdej edycji widzą tylko narzędzia edycji harness; plik nadpisany za pomocą polecenia powłoki je omija. Hook końca tury ponownie sprawdza każdy plik zmieniony w tej turze (`git diff`), więc stanowi zabezpieczenie dla tych edycji.
- Limity czasu są zwykle podawane w **sekundach**. Sprawdź jednostkę przed skopiowaniem liczby.
- Udowodnij działanie każdego hooka, zanim mu zaufasz: uruchom skrypt z przykładowym ładunkiem na celowo uszkodzonym pliku i na czystym, a następnie cofnij błąd.
- Nigdy nie nadpisuj po cichu istniejącej konfiguracji hooków. Przeprowadź audyt, nazwij defekty, scal i pokaż diff.

### Granice lekcji

- Nie zmieniaj strategii ryzyka ani definicji bramek — to Lekcja 1 (`/10x-test-plan`).
- Nie pisz tutaj nowych testów — hooki uruchamiają tylko testy utworzone w Lekcji 2.
- Nie pisz scenariuszy E2E ani weryfikacji w przeglądarce — to Lekcja 4.
- Nie twórz potoków CI ani nie instaluj bez pytania menedżerów git-hooków; rekomenduj bramki pre-commit/pre-push i pozwól użytkownikowi zdecydować.

<!-- END @przeprogramowani/10x-cli -->
