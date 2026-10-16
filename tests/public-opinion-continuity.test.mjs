import test from 'node:test';
import assert from 'node:assert/strict';
import { mergePublicOpinionStream, normalizePublicOpinionCache, normalizePublicOpinionPayload } from '../public-opinion.js';
const at='2026-10-17T00:00:00Z',later='2026-10-17T01:00:00Z';
const snapshot=(minute,payload,date=at)=>normalizePublicOpinionPayload(payload,{validEventIds:['e1','e2'],sourceWorldMinute:minute,generatedAt:date});
const post=(id='thread',title='夜市咖啡开张',replies=[{author:'甲',text:'想去尝尝'}])=>({id,relatedEventId:'e1',board:'生活',title,summary:'店门口排了队',replies});

test('持续新闻保留原ID与发布时间，新增内容只改变更新时间',()=>{
 const before=snapshot(600,{news:[{id:'old-news',relatedEventId:'e1',headline:'小店开张',summary:'准备开门'}]});
 const after=snapshot(660,{news:[{id:'model-renamed',relatedEventId:'e1',headline:'小店已经开门',summary:'门口排起队'}]},later);
 const merged=normalizePublicOpinionCache(mergePublicOpinionStream(before,after));
 assert.equal(merged.news.length,1);assert.equal(merged.news[0].id,'old-news');assert.equal(merged.news[0].publishedAt,at);assert.equal(merged.news[0].publishedWorldMinute,600);assert.equal(merged.news[0].worldMinute,660);assert.equal(merged.news[0].updatedAt,later);
});

test('续帖保留身份并追加去重回复，序列化恢复后保持原始发布时刻',()=>{
 const before=snapshot(600,{forums:[post()]});
 const after=snapshot(660,{forums:[post('thread','夜市咖啡开张：排队情况',[{author:'甲',text:'想去尝尝'},{author:'乙',text:'已经买到了'}])]},later);
 const merged=normalizePublicOpinionCache(JSON.parse(JSON.stringify(mergePublicOpinionStream(before,after))));
 assert.equal(merged.forums.length,1);assert.equal(merged.forums[0].id,'thread');assert.equal(merged.forums[0].publishedWorldMinute,600);assert.equal(merged.forums[0].publishedAt,at);assert.deepEqual(merged.forums[0].replies.map(r=>r.text),['想去尝尝','已经买到了']);
});

test('同事件的新主题保留旧主题；模型数组顺序变化不会改变默认主题ID',()=>{
 const first=snapshot(600,{forums:[post('', '咖啡探店'),post('', '公园散步')]});
 const reordered=snapshot(660,{forums:[post('', '公园散步'),post('', '咖啡探店')]},later);
 assert.deepEqual(first.forums.map(i=>i.id).sort(),reordered.forums.map(i=>i.id).sort());
 const next=snapshot(660,{forums:[post('new-topic','夜市新摊位')]},later);
 const merged=mergePublicOpinionStream(first,next);assert.equal(merged.forums.length,3);assert.ok(merged.forums.some(i=>i.title==='咖啡探店'));
});

test('没有实质更新时不刷新发布时间与排序，累计讨论最多保留八条',()=>{
 let value=snapshot(600,{forums:[post()]});
 const unchanged=snapshot(660,{forums:[post()]},later);
 const quiet=mergePublicOpinionStream(value,unchanged);assert.equal(quiet.forums[0].worldMinute,600);assert.equal(quiet.forums[0].updatedAt,at);
 for(let i=0;i<10;i++) value=normalizePublicOpinionCache(mergePublicOpinionStream(value,snapshot(610+i,{forums:[post('thread','夜市咖啡开张',[{author:'读者'+i,text:'讨论'+i}])]},later)));
 assert.equal(value.forums[0].replies.length,8);assert.equal(value.forums[0].publishedWorldMinute,600);assert.ok(value.forums[0].replies.some(r=>r.text==='讨论9'));
});
