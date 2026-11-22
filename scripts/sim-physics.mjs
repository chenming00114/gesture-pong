import * as G from '../src/game.js';
G.configureField(true);
const g = G.createGame(); let hits=0, walls=0, serves=0;
for (let i=0;i<120*600 && g.state!=='over';i++){
  {const d=(g.ball.vx<0?g.ball.z:0)-g.player.target; g.player.target+=Math.max(-6/120,Math.min(6/120,d));} // imperfect player
  if (g.state==='serve'){ G.serve(g); serves++; }
  G.step(g);
  for (const e of g.events.splice(0)) { if(e==='hit')hits++; if(e==='wall')walls++; }
}
console.log({score:g.score,state:g.state,hits,walls,serves,finalSpeed:g.speed.toFixed(1)});
