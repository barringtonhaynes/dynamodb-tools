const assert = require("node:assert/strict");
const test = require("node:test");
const nav = require("../../app/static/navigation-model.js");
const aws = { mode: "aws", account: "111111111111", region: "eu-west-2" };
test("favourites and saved queries are scoped and produce distinct tree IDs", () => {
  const entries = {
    [nav.favouriteKey(aws)]: '["people"]',
    'dynamodb-tools.saved-queries.v1:["111111111111","eu-west-2","people"]':
      '[{"id":"query-1","name":"Recent people"}]',
  };
  const tree = nav.roots(
    { connection: aws, tables: [{ TableName: "people" }] },
    entries,
  );
  assert.equal(tree[1].children[0].table, "people");
  const query = tree[2].children[1].children[1].children[0];
  assert.equal(query.route, "tables/people?query=query-1");
  assert(nav.validRoute(query.route));
  const ids = [];
  const walk = (nodes) =>
    nodes.forEach((n) => {
      ids.push(n.id);
      if (n.children) walk(n.children);
    });
  walk(tree);
  assert.equal(new Set(ids).size, ids.length);
  assert.deepEqual(
    nav.favourites({ ...aws, account: "222222222222" }, entries),
    [],
  );
  assert.deepEqual(
    nav.favourites({ ...aws, region: "us-east-1" }, entries),
    [],
  );
  assert.deepEqual(
    nav.favourites(
      { mode: "local", endpoint: "http://localhost:8000", region: aws.region },
      entries,
    ),
    [],
  );
});
test("invalid favourites and routes are rejected without navigating elsewhere", () => {
  for (const value of ["null", "{}", '["../secret"]', "[1]"])
    assert.throws(() =>
      nav.favourites(aws, { [nav.favouriteKey(aws)]: value }),
    );
  for (const route of [
    "https://evil.test",
    "tables/../../settings",
    "settings/invalid",
    "tables/people?view=delete",
    "tables/people?query=x&url=other",
  ])
    assert(!nav.validRoute(route), route);
  for (const route of [
    "tables/people?view=streams",
    "settings/workspace",
    "tables",
    "overview",
  ])
    assert(nav.validRoute(route));
});
