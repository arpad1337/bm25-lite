import * as sw from 'stopword';

export interface ISearchResultWithIDFTFScore {
  idftf?: number;
  maxScore?: number;
  matchingTermCount?: number;
  matchingStemmedTermCount?: number;
}

export interface ISearchResultWithTerms<Terms>
  extends ISearchResultWithIDFTFScore {
  ____dummyKey?: undefined;
  tags: Terms[];
  terms?: string[];
  hasAllTags?: boolean;
}

export interface ITermCounters {
  uniqueDocumentCountWhereMatching: number;
  globalTermCountWhereTagFound: number;
}

export type Enum<T> = object & {
  [k in keyof T]: T[k];
};

export enum SortOrder {
  ASC,
  DESC,
}

class KeywordMatchCounter {
  private _uniqueDocumentIds: Set<string>;
  private _globalTermCountWhereTagFound: number = 0;

  constructor(startGlobalTermCountWhereTagFound: number, currentId: string) {
    this._globalTermCountWhereTagFound = startGlobalTermCountWhereTagFound;
    this._uniqueDocumentIds = new Set();
    this._uniqueDocumentIds.add(currentId);
  }

  set currentId(value: string) {
    this._uniqueDocumentIds.add(value);
  }

  get uniqueDocumentCountWhereMatching(): number {
    return this._uniqueDocumentIds.size;
  }

  get globalTermCountWhereTagFound(): number {
    return this._globalTermCountWhereTagFound;
  }

  set globalTermCountWhereTagFound(value: number) {
    this._globalTermCountWhereTagFound = value;
  }

  hasId(currentId: string) {
    return this._uniqueDocumentIds.has(currentId);
  }
}

export class SearchResultEvaluator<
  Terms,
  K extends ISearchResultWithTerms<Terms> & { id: string }
> {
  private data: K[] = [];
  private predicate = '';
  private terms: Terms[] = [];
  private stemmedWords: string[] = [];
  private selector: (keyof K & (string | symbol))[] = ['____dummyKey'];
  private termsEnum: Enum<Terms> | null = null;

  private $cacheMap: Map<string, ISearchResultWithIDFTFScore>;

  constructor(
    data: K[],
    termsEnum: Enum<Terms>,
    selector?: (keyof K & (string | symbol))[]
  ) {
    this.$cacheMap = new Map<string, ISearchResultWithIDFTFScore>();
    this.termsEnum = termsEnum;
    !!selector && (this.selector = selector);
    this.setData(data);
  }

  setData(data: K[]) {
    this.data = data.map(this.resetIDFTF(this.$cacheMap)).map((row) => {
      const keys = this.selector.map((s) => String(row[s]));
      const words = new Map<string, number>();
      keys.forEach((k) => {
        (
          k
            .trim()
            .toLocaleLowerCase()
            .replace(/[`~!@#$%^&*()_|+\-=?;:'",.<>\{\}\[\]\\\/]/gi, '')
            .split(' ') || []
        )
          .map((v: string) => v.toLocaleLowerCase().trim())
          .map((v) => {
            words.set(v, !!words.get(v) ? words.get(v)! + 1 : 1);
          });
      });
      row.terms = [...words.keys()];
      this.$cacheMap.set(row.id, row);
      return row;
    });
  }

  getCachedDataEntryByIdSync(id: string): K | null {
    return (this.$cacheMap.get(id) as K) || null;
  }

  setSelector(selector: (keyof K & (string | symbol))[]) {
    this.selector = selector;
  }

  setPredicate(predicate: string) {
    this.predicate = predicate;
    const terms = sw
      .removeStopwords(
        this.predicate
          .trim()
          .toLocaleLowerCase()
          .replace(/[`~!@#$%^&*()_|+\-=?;:'",.<>\{\}\[\]\\\/]/gi, '')
          .split(' ') || []
      )
      .map((v: string) => v.toLocaleLowerCase().trim());
    this.stemmedWords = [];
    terms.forEach((t) => {
      if (!!t.trim() && this.stemmedWords.indexOf(t) === -1) {
        this.stemmedWords.push(t);
      }
    });
  }

  setTerms(terms: Terms[]) {
    this.terms = terms;
  }

  hasQuery() {
    return this.terms.length > 0 || this.stemmedWords.length > 0;
  }

  evaluateResults(): K[] {
    const filteredData = this.data
      .map(this.resetIDFTF(this.$cacheMap))
      .filter(this.predicateFunctor(this.stemmedWords, this.terms));
    if (this.hasQuery()) {
      return this.filterAndRank(filteredData, this.stemmedWords, this.terms);
    }
    return filteredData;
  }

  getRelevance(entry: K): number {
    const normalizedIDFTF = entry.idftf! / entry.maxScore!;
    const localizedScore =
      Math.floor(Math.ceil(normalizedIDFTF * 100 * 333) / 333) / 100;
    const normalizedScore = localizedScore;
    return normalizedScore;
  }

  private resetIDFTF(
    $cacheMap: Map<string, ISearchResultWithIDFTFScore>
  ): (entry: K) => K {
    return (entry: K) => {
      const { idftf, hasAllTags, ...entryWithoutIDFTF } = entry;
      $cacheMap.set(entryWithoutIDFTF.id, entryWithoutIDFTF!);
      return {
        ...entryWithoutIDFTF,
      } as K;
    };
  }

  private predicateFunctor(
    terms: string[],
    tags: Terms[]
  ): (row: K) => boolean {
    return (row: K): boolean => {
      if (terms.length === 0 && tags.length === 0) {
        return true;
      }
      const rowTags: Terms[] = row.tags!;
      return (
        (terms.length > 0 &&
          terms[0] !== '' &&
          terms.some((term) => row.terms!.some((t) => t.indexOf(term) > -1))) ||
        rowTags.some((tag) => {
          return tags.indexOf(tag) > -1;
        })
      );
    };
  }

  private filterAndRank(
    data: K[],
    stemmedTerms: string[],
    terms: Terms[]
  ): K[] {
    data = data.reduce((accu, row) => {
      row = {
        ...row,
        matchingTermCount: terms.reduce((accu, tag) => {
          return accu + (row.tags!.indexOf(tag) > -1 ? 1 : 0);
        }, 0),
      };

      const matchingTermCountForTags = row.matchingTermCount;

      const keys = this.selector.map((s) => String(row[s]));
      row = {
        ...row,
        matchingStemmedTermCount: stemmedTerms.reduce((accu, term) => {
          return (
            accu +
            (!!keys.some((k) => {
              return (
                k
                  .trim()
                  .toLocaleLowerCase()
                  .replace(/[`~!@#$%^&*()_|+\-=?;:'",.<>\{\}\[\]\\\/]/gi, '')
                  .split(' ') || []
              )
                .map((v: string) => v.toLocaleLowerCase().trim())
                .some((t: string) => t === term);
            })
              ? 1
              : 0)
          );
        }, row.matchingStemmedTermCount || 0),
      };

      if (matchingTermCountForTags === terms.length) {
        row = {
          ...row,
          hasAllTags: true,
        };
      }

      accu.push(row);
      return accu;
    }, [] as K[]);

    let corpusTermCountInFilter = 0;
    const tagsTF: Map<string, KeywordMatchCounter> = new Map();
    const termsTF: Map<string, KeywordMatchCounter> = new Map();

    data.forEach((row) => {
      row.tags!.forEach((tagTerm: Terms) => {
        const tag = `${tagTerm}`;
        if (terms.indexOf(tagTerm) > -1) {
          if (tagsTF.has(tag)) {
            const counter = tagsTF.get(tag)!;
            if (!counter.hasId(row.id)) {
              counter.currentId = row.id;
              counter.globalTermCountWhereTagFound += row.tags!.length;
            }
            tagsTF.set(tag, counter);
          } else {
            tagsTF.set(tag, new KeywordMatchCounter(row.tags!.length, row.id));
            corpusTermCountInFilter += 1;
          }
        }
      });
      const keys = this.selector.map((s) => String(row[s]));
      keys.forEach((term) => {
        const currentStemmedTerms = (
          term.trim().toLocaleLowerCase().split(' ') || []
        ).map((v: string) => v.toLocaleLowerCase().trim());
        stemmedTerms!.forEach((tagTerm) => {
          const tag = `${tagTerm}`;
          currentStemmedTerms.forEach((ct: string) => {
            if (ct === tag) {
              if (termsTF.has(tag)) {
                const counter = termsTF.get(tag)!;
                if (!counter.hasId(row.id)) {
                  counter.currentId = row.id;
                  counter.globalTermCountWhereTagFound += row.tags!.length;
                }
                termsTF.set(tag, counter);
              } else {
                termsTF.set(
                  tag,
                  new KeywordMatchCounter(currentStemmedTerms!.length, row.id)
                );
                corpusTermCountInFilter += 1;
              }
            }
          });
        });
      });
    });

    const strongestTagInCorpus: string | null =
      this.computeStrongestTag(tagsTF);
    let strongestTagTFRelevancy = 1;
    let strongestTagUniqueDocument = 0;
    let strongestTermTFRelevancy = 1;
    let strongestTermUniqueDocument = 0;
    if (!!strongestTagInCorpus) {
      strongestTagTFRelevancy =
        corpusTermCountInFilter /
        tagsTF.get(strongestTagInCorpus)!.globalTermCountWhereTagFound;
      strongestTagUniqueDocument =
        tagsTF.get(strongestTagInCorpus)!.uniqueDocumentCountWhereMatching;
    }
    const strongestTermInCorpus: string | null =
      this.computeStrongestTag(termsTF);
    if (!!strongestTermInCorpus) {
      strongestTermTFRelevancy =
        corpusTermCountInFilter /
        termsTF.get(strongestTermInCorpus)!.globalTermCountWhereTagFound;
      strongestTermUniqueDocument = termsTF.get(
        strongestTermInCorpus
      )!.uniqueDocumentCountWhereMatching;
    }

    data.forEach((row) => {
      let rowAccu = {
        ...row,
        idftf: 0,
        maxScore: 0,
      };
      const terms = [
        ...new Set(
          row
            .terms!.concat(
              row
                .tags!.map((tagTerm) =>
                  sw.removeStopwords(
                    `${String(this.termsEnum![tagTerm as keyof Terms])
                      .toLocaleLowerCase()
                      .trim()}`.split(' ') || []
                  )
                )
                .reduce((a, e) => (!!e && a.concat(e)) || a, [])
            )
            .concat(row.tags!.map((tagTerm) => `${tagTerm}`))
        ),
      ];
      terms.forEach((tag: string) => {
        const inverseDocumentFrequency =
          // Current Inverse Document Frequence
          (1 /
            (Math.log(
              data.length /
                ((tagsTF.get(tag) &&
                  tagsTF.get(tag)!.uniqueDocumentCountWhereMatching) ||
                  data.length)
            ) +
              1)) *
          // Normalization by the strongest Tag
          (Math.log(
            strongestTagUniqueDocument /
              ((tagsTF.get(tag) &&
                tagsTF.get(tag)!.uniqueDocumentCountWhereMatching) ||
                strongestTagUniqueDocument)
          ) +
            1);

        const currentTagTFRelevancy =
          corpusTermCountInFilter /
          ((tagsTF.get(tag) && tagsTF.get(tag)!.globalTermCountWhereTagFound) ||
            corpusTermCountInFilter);

        const termFrequency =
          0.5 +
          0.5 *
            // Current local term frequency when all tag is unique
            (1 / row.tags!.length) *
            // First weight: cross-relevancy across the maching documents
            (1 / currentTagTFRelevancy) *
            // Second weight: normalization by the strongest Tag
            (1 / strongestTagTFRelevancy);

        const score = inverseDocumentFrequency * termFrequency;

        rowAccu = {
          ...rowAccu,
          idftf: rowAccu.idftf + (tagsTF.has(tag) ? score : 0),
          maxScore: rowAccu.maxScore + score,
        };
      });

      this.$cacheMap.set(rowAccu.id, rowAccu);

      return rowAccu;
    });

    const docsWithIDFTF: K[] = data.map((row) => {
      const rowAccuOld = this.$cacheMap.get(row.id)!;

      let rowAccu = {
        ...row,
        idftf: 0,
        maxScore: 0,
      };
      const terms = [
        ...new Set(
          row
            .terms!.map(
              (term) =>
                term
                  .toLocaleLowerCase()
                  .replace(/[`~!@#$%^&*()_|+\-=?;:'",.<>\{\}\[\]\\\/]/gi, '')
                  .trim()
                  .split(' ') || []
            )
            .reduce((a, e) => (!!e && a.concat(e)) || a, [])
            .filter((t: string) => stemmedTerms.includes(t))
        ),
      ];
      terms.forEach((tag: string) => {
        const inverseDocumentFrequency =
          // Current Inverse Document Frequence
          (1 /
            (Math.log(
              data.length /
                ((termsTF.get(tag) &&
                  termsTF.get(tag)!.uniqueDocumentCountWhereMatching) ||
                  data.length)
            ) +
              1)) *
          // Normalization by the strongest Tag
          (Math.log(
            strongestTermUniqueDocument /
              ((termsTF.get(tag) &&
                termsTF.get(tag)!.uniqueDocumentCountWhereMatching) ||
                strongestTermUniqueDocument)
          ) +
            1);

        const currentTermTFRelevancy =
          corpusTermCountInFilter /
          ((termsTF.get(tag) &&
            termsTF.get(tag)!.globalTermCountWhereTagFound) ||
            corpusTermCountInFilter);

        const termFrequency =
          0.5 +
          0.5 *
            // Current local term frequency when all tag is unique
            (1 / row.terms!.length) *
            // First weight: cross-relevancy across the maching documents
            (1 / currentTermTFRelevancy) *
            // Second weight: normalization by the strongest Tag
            (1 / strongestTermTFRelevancy);

        const score = inverseDocumentFrequency * termFrequency;

        rowAccu = {
          ...rowAccu,
          idftf: rowAccu.idftf + (termsTF.has(tag) ? score : 0),
          maxScore: rowAccu.maxScore + score,
        };
      });

      rowAccu.idftf = rowAccu.idftf! || rowAccuOld.idftf || 0;
      rowAccu.maxScore = rowAccu.maxScore! || rowAccuOld.maxScore || 0;

      this.$cacheMap.set(rowAccu.id, rowAccu);

      return rowAccu;
    });

    const docsWithIDFTF2 = docsWithIDFTF.filter((r) => !!r.idftf);

    return docsWithIDFTF2;
  }

  private computeStrongestTag(
    tagsTF: Map<string, ITermCounters>
  ): string | null {
    let max = 0;
    let maxTag: string | null = null;
    for (let key of tagsTF.keys()) {
      const tag = tagsTF.get(key);
      const newMax = Math.max(tag!.globalTermCountWhereTagFound, max);
      if (newMax > max) {
        max = newMax;
        maxTag = key;
      }
    }
    return maxTag;
  }

  static IDFTFSorter<U extends ISearchResultWithIDFTFScore>(
    selector: keyof U,
    sortOrderForScores: SortOrder = SortOrder.DESC
  ): (a: U, b: U) => number {
    return (a: U, b: U) => {
      if ('idftf' in a && 'idftf' in b) {
        if (sortOrderForScores === SortOrder.DESC) {
          return (b.idftf! / b.maxScore!)! - (a.idftf! / a.maxScore!)!;
        }
        return (a.idftf! / a.maxScore!)! - (b.idftf! / b.maxScore!)!;
      }
      return String(a[selector]).localeCompare(String(b[selector]));
    };
  }
}
