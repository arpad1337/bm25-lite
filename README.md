# bm25-lite

Okapi BM25 (lite) in TypeScript

## Usage

```typescript

    const searchResultEvaluator = new SearchResultEvaluator<
      Terms, // fixed list of terms (enum)
      IItemWithIDFTF
    >(items, Terms as Enum<Terms>, ['selector1', 'selector2', 'selector3']);

    searchResultEvaluator.setPredicate(predicate);
    searchResultEvaluator.setTerms(terms);

    const results = searchResultEvaluator.evaluateResults();

```

## Author

@arpad1337

## License

MIT
