const fs=require('fs'),vm=require('vm'),os=require('os'),path=require('path');
const TMP=os.tmpdir();
globalThis.window=globalThis; globalThis.document={readyState:'complete',documentElement:{},head:{appendChild(){}},addEventListener(){}};
globalThis.localStorage={getItem:()=>null,setItem(){},removeItem(){}};
for(const f of ['00-util','10-parse','20-metrics','25-classify','40-coach','60-insights'])
  vm.runInThisContext(fs.readFileSync('src/js/'+f+'.js','utf8'),{filename:f});

(async()=>{
  const buf=fs.readFileSync(path.join(TMP, 'export.xml'));
  const file=new Blob([buf]); file.name='export.xml';
  const t0=Date.now();
  const res=await parseHealthExport(file,{splits:true,dedupe:true},(m,p)=>{});
  console.log('--- parse ---');
  console.log('runs',res.runs.length,'other',res.other.length,'merged',res.meta.merged,
              'samples',res.meta.samples,'withSplits',res.meta.runsWithSplits,'ms',res.meta.ms);

  App.runs=res.runs; App.best=res.best; App.meta=res.meta; App.unit='km';
  App.cls=classifyRuns(App.runs);
  App.walks=App.runs.filter(r=>r.kind==='walk');
  App.train=App.runs.filter(r=>r.kind!=='walk');
  const mixAll={}; for(const r of App.train) mixAll[r.kind]=(mixAll[r.kind]||0)+1;
  console.log('\n--- classification ---');
  console.log('walk-like set aside',App.walks.length,'| HRmax est',App.cls.hr.max||'n/a','| easy ref',App.cls.easyRef?fmtPace(App.cls.easyRef)+'/km':'n/a');
  console.log(Object.entries(mixAll).map(([k,v])=>k+' '+v).join('  '));
  const fit=buildFitness(App.train,App.best,{hr:App.cls.hr,easyRef:App.cls.easyRef});
  App.fit=fit;
  computeLoad(App.train,fit.paces.T);

  console.log('\n--- best efforts ---');
  for(const t of TARGETS) if(res.best[t.m])
    console.log(String(t.label).padEnd(9), hms(res.best[t.m].sec).padStart(8),
      paceStr(res.best[t.m].sec,t.m).padStart(9), res.best[t.m].method,
      new Date(res.best[t.m].date).toISOString().slice(0,10));

  console.log('\n--- fitness ---');
  console.log('VDOT',fit.vdot.toFixed(2),'| anchor',fit.anchor.label,hms(fit.anchor.sec),
              '| riegel',fit.riegel.toFixed(3),fit.riegelFitted?'(fitted)':'(default)',
              '| weekly',(fit.weeklyM/1000).toFixed(1),'km');
  console.log('paces  E',fmtPace(fit.paces.E),' M',fmtPace(fit.paces.M),' T',fmtPace(fit.paces.T),
              ' I',fmtPace(fit.paces.I),' R',fmtPace(fit.paces.R));
  console.log('\n--- predictions ---');
  for(const p of fit.preds) console.log(p.label.padEnd(16),hms(p.sec,true),'   ',hms(p.lo,true),'-',hms(p.hi,true),' ',p.confidence,' pace',paceStr(p.sec,p.m));

  const b=bucketRuns(App.train);
  console.log('\n--- volume ---');
  console.log('weeks',b.weeks.length,'months',b.months.length,'years',b.years.map(y=>y.key+':'+(y.m/1000).toFixed(0)+'km').join(' '));
  const dw=denseWeeks(b.weeks); console.log('dense weeks',dw.length,'last 4:',dw.slice(-4).map(w=>(w.m/1000).toFixed(1)).join(', '));

  console.log('\n--- signals ---');
  const sig=trainingSignals();
  console.log('acwr',sig.acwr.toFixed(2),'easyShare',sig.easyShare.toFixed(2),'tsb',sig.tsb.toFixed(0),'ctl',sig.ctl.toFixed(0),'daysSince',sig.daysSince);
  sig.flags.forEach(f=>console.log(' ',f.k,'-',f.t));

  console.log('\n--- plan ---');
  const raceDate=new Date(Date.now()+16*7*86400000).toISOString().slice(0,10);
  for(const race of ['10K','HM','FM']){
    const plan=buildPlan({race,raceDate,days:5,longDay:5,level:'solid',cross:true},fit,App.train);
    if(plan.error){console.log(race,'ERROR',plan.error);continue;}
    const peak=Math.max(...plan.weeks.map(w=>w.target));
    console.log(race,'weeks',plan.total,'start',(plan.startVol/1000).toFixed(1),'peak',(peak/1000).toFixed(1),
      'longest',(Math.max(...plan.weeks.map(w=>w.longM))/1000).toFixed(1),
      'goal',plan.goal?hms(plan.goal.sec,true):'-');
    // A rebound out of a planned absorb week, and race week itself, are not
    // jumps — the underlying ramp is what must stay smooth.
    const bad=plan.weeks.filter((w,i)=>i>0&&!w.isRaceWeek&&!plan.weeks[i-1].down&&w.target>plan.weeks[i-1].target*1.15);
    if(bad.length) console.log('   !! jumpy weeks',bad.map(w=>w.i+1).join(','));
    const ramps=plan.weeks.filter((w,i)=>i>0&&!w.isRaceWeek&&w.base>plan.weeks[i-1].base*1.115);
    if(ramps.length) console.log('   !! ramp above 11%/wk at',ramps.map(w=>w.i+1).join(','));
    const empty=plan.weeks.filter(w=>w.days.filter(d=>d.kind!=='rest').length===0);
    if(empty.length) console.log('   !! empty weeks',empty.length);
    // Regression check for a real bug found in review: Build-phase weeks
    // decide nQ=2 (two quality sessions) for HM/FM at 5+ days/week, but an
    // earlier version silently relabelled the second one 'easy', so the
    // plan delivered half the quality work it claimed to. Every non-taper,
    // non-race Build week must actually contain 2 'quality'-kind days.
    if (race !== '10K') {
      const buildWeeks = plan.weeks.filter(w => w.phase === 'Build' && !w.isRaceWeek);
      const short = buildWeeks.filter(w => w.days.filter(d => d.kind === 'quality').length < 2);
      if (short.length) console.log('   !! Build weeks with <2 real quality sessions:', short.map(w => w.i + 1).join(','));
    }
  }
  const plan=buildPlan({race:'FM',raceDate,days:5,longDay:5,level:'solid',cross:true},fit,App.train);
  console.log('\nWeek 1:'); plan.weeks[0].days.forEach(d=>console.log('  ',DOW[d.dow].padEnd(4),(d.m?(d.m/1000).toFixed(1)+'km':'   -').padStart(8),d.title,'|',d.detail.slice(0,70)));
  const pk=plan.weeks[plan.weeks.length-4];
  console.log('\nWeek',pk.i+1,'('+pk.phase+'):'); pk.days.forEach(d=>console.log('  ',DOW[d.dow].padEnd(4),(d.m?(d.m/1000).toFixed(1)+'km':'   -').padStart(8),d.title,'|',d.detail.slice(0,70)));
  const rw=plan.weeks[plan.weeks.length-1];
  console.log('\nRace week:'); rw.days.forEach(d=>console.log('  ',DOW[d.dow].padEnd(4),(d.m?(d.m/1000).toFixed(1)+'km':'   -').padStart(8),d.title));

  console.log('\n--- brief size ---', JSON.stringify(athleteBrief()).length, 'chars');
  console.log('total test time', Date.now()-t0,'ms');
})().catch(e=>{console.error('FAILED',e);process.exit(1)});
