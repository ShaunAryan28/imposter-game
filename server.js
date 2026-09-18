const express=require('express');const http=require('http');const {Server}=require('socket.io');
const app=express(),server=http.createServer(app),io=new Server(server);app.use(express.static('public'));
const rooms=new Map();
const pairs=[['Apple','Pear'],['Cat','Dog'],['Beach','Desert'],['Coffee','Tea'],['Moon','Sun'],['Doctor','Nurse'],['Train','Bus'],['Pizza','Burger'],['Rain','Snow'],['King','Queen']];
function code(){let c;do{c=Math.random().toString(36).slice(2,7).toUpperCase()}while(rooms.has(c));return c}
function state(r){return {code:r.code,host:r.host,started:r.started,players:[...r.players.values()].map(p=>({id:p.id,name:p.name,hasWord:!!p.word}))}}
io.on('connection',s=>{
 s.on('create',({name})=>{const c=code();const r={code:c,host:s.id,started:false,players:new Map()};r.players.set(s.id,{id:s.id,name:name||'Player',word:null,role:null});rooms.set(c,r);s.join(c);s.data.room=c;s.emit('joined',{...state(r),you:s.id});io.to(c).emit('state',state(r));});
 s.on('join',({code,name})=>{const r=rooms.get((code||'').toUpperCase());if(!r)return s.emit('errorMsg','Room not found');if(r.started)return s.emit('errorMsg','Round already started');r.players.set(s.id,{id:s.id,name:name||'Player',word:null,role:null});s.join(r.code);s.data.room=r.code;s.emit('joined',{...state(r),you:s.id});io.to(r.code).emit('state',state(r));});
 s.on('start',()=>{const r=rooms.get(s.data.room);if(!r||r.host!==s.id||r.players.size<3)return s.emit('errorMsg','Host only; at least 3 players required');const pair=pairs[Math.floor(Math.random()*pairs.length)],ps=[...r.players.values()];const imp=Math.floor(Math.random()*ps.length);ps.forEach((p,i)=>{p.role=i===imp?'imposter':'player';p.word=i===imp?pair[1]:pair[0]});r.started=true;io.to(r.code).emit('state',state(r));ps.forEach(p=>io.to(p.id).emit('privateWord',{word:p.word,role:p.role}));});
 s.on('reset',()=>{const r=rooms.get(s.data.room);if(!r||r.host!==s.id)return;r.started=false;r.players.forEach(p=>{p.word=null;p.role=null});io.to(r.code).emit('state',state(r));});
 s.on('disconnect',()=>{const r=rooms.get(s.data.room);if(!r)return;r.players.delete(s.id);if(!r.players.size)rooms.delete(r.code);else {if(r.host===s.id)r.host=[...r.players.keys()][0];io.to(r.code).emit('state',state(r));}});
});server.listen(process.env.PORT||3000,()=>console.log('Running on port '+(process.env.PORT||3000)));
