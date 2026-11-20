export function aiInstructionsInventory() {
  return {
    query: `DEFINE
  VAR _Metadata = INFO.LINGUISTICMETADATA()
  VAR _Count = COALESCE(COUNTROWS(_Metadata), 0)
EVALUATE
  UNION(
    ROW("CultureId", BLANK(), "Content", BLANK(), "ContentLength", BLANK(), "ExpectedMetadataCount", _Count),
    SELECTCOLUMNS(
      TOPN(17, _Metadata, [ID], ASC),
      "CultureId", CONVERT([CultureID], STRING),
      "Content", IF(LEN([Content]) <= 262144, [Content], BLANK()),
      "ContentLength", LEN([Content]),
      "ExpectedMetadataCount", _Count
    )
  )`,
    queryTimeout: 20,
    resultSetRowCountLimit: 18,
  };
}
