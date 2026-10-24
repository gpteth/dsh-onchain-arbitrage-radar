import { test } from 'node:test'
import assert from 'node:assert/strict'
import { searchTopics, topicById, TOPICS } from '../src/knowledge.js'

test('every topic has the fields the tool returns', () => {
  assert.ok(TOPICS.length >= 12)
  for (const topic of TOPICS) {
    assert.match(topic.id, /^[a-z0-9-]+$/)
    assert.ok(topic.title.length > 0)
    assert.ok(topic.summary.length > 0)
    assert.ok(topic.body.length > 0)
    assert.ok(topic.apply.length > 0)
    assert.ok(topic.tags.length > 0)
  }
  assert.equal(new Set(TOPICS.map(topic => topic.id)).size, TOPICS.length)
})

test('search matches Chinese and English terms', () => {
  const funding = searchTopics('funding', 3)
  assert.ok(funding.some(topic => topic.id === 'funding-carry'))
  const chinese = searchTopics('滑点', 3)
  assert.ok(chinese.some(topic => topic.id === 'spread-not-executable'))
  assert.ok(searchTopics('稳定币').some(topic => topic.id === 'stablecoin-basis'))
  assert.ok(searchTopics('币股').some(topic => topic.id === 'tokenized-stock-clock'))
})

test('search returns nothing for unrelated text and respects the limit', () => {
  assert.deepEqual(searchTopics('zzzz-unknown-term'), [])
  assert.ok(searchTopics('风险', 1).length <= 1)
  assert.deepEqual(searchTopics('   '), [])
})

test('topic lookup is exact and case-insensitive', () => {
  assert.equal(topicById('NET-EDGE').id, 'net-edge')
  assert.equal(topicById('missing'), undefined)
})
