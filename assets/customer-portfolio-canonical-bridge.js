(function(){
  'use strict';
  if(window.__BH_CUSTOMER_PORTFOLIO_CANONICAL_BRIDGE__)return;
  window.__BH_CUSTOMER_PORTFOLIO_CANONICAL_BRIDGE__=true;
  const VERSION='2026.07.22-customer-portfolio-canonical-bridge-v2-original-texts';
  const clean=value=>String(value??'').trim();

  function salesType(employee,segment){
    const seg=clean(segment),role=clean(employee?.role);
    if(seg==='بلوك'||seg==='block'||role.includes('بلوك'))return'block';
    return'concrete';
  }
  function safeDate(){try{return typeof fmtG==='function'&&typeof today==='function'?fmtG(today()):new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Riyadh'});}catch{return new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Riyadh'});}}
  function safeHijri(){try{return typeof hijri==='function'?hijri():'';}catch{return'';}}
  function safeReference(){try{return typeof ref==='function'?ref():`BHF-${Date.now().toString(36).toUpperCase()}`;}catch{return`BHF-${Date.now().toString(36).toUpperCase()}`;}}
  function portfolio(employee,segment){try{return typeof clientPortfolioForEmployee==='function'?clientPortfolioForEmployee(employee,segment):[];}catch(error){console.warn('[canonical declaration] portfolio lookup failed',error);return[];}}

  async function install(){
    let template,texts;
    try{[template,texts]=await Promise.all([import('/shared/customer-portfolio-declaration.js?v=20260722-1'),import('/shared/canonical-declaration-texts.js?v=20260722-1')]);}
    catch(error){console.error('[canonical declaration] shared renderer failed',error);return false;}
    if(typeof template.renderCustomerPortfolioDeclaration!=='function')return false;
    window.docCli=function(employee,segment){
      const cfg=typeof D!=='undefined'&&D?.cfg?D.cfg:{},rows=portfolio(employee,segment),type=salesType(employee,segment),customers=rows.map(row=>({
        name:row.name,
        segment:row._portfolioSegment||row.seg||(type==='block'?'بلوك':'خرسانة'),
        registry:row.cr||row.code||'',
        code:row.code||row.id||'',
        phone:row.tel||row.phone||'',
        creditLimit:Number(row.cap??cfg.cap??0),
        paymentDays:Number(row.days??cfg.days??3)
      }));
      const rendered=template.renderCustomerPortfolioDeclaration({
        type,
        companyName:cfg.name||'مصنع بن حامد للبلوك والخرسانة الجاهزة',
        employee:{name:employee?.name||'',nationalId:employee?.nid||'',role:employee?.role||'',number:employee?.no||'',phone:employee?.tel||''},
        customers,
        days:Number(cfg.days||3),
        defaultCreditLimit:Number(cfg.cap||0),
        declarationText:texts.CUSTOMER_PORTFOLIO_DECLARATION,
        extraText:texts.CUSTOMER_PORTFOLIO_EXTRA,
        ackText:texts.DECLARATION_ACK,
        authorizedName:[cfg.auth,cfg.authT].filter(Boolean).join(' — '),
        documentRef:safeReference(),
        dateGregorian:safeDate(),
        dateHijri:safeHijri(),
        baseUrl:location.origin+'/'
      });
      return rendered.css+rendered.html;
    };
    window.BinHamidCustomerPortfolioDeclaration={...template,...texts};
    console.info('[BinHamid]',VERSION,'ready — website and Telegram share one declaration renderer and one original text source');
    return true;
  }
  window.bhCanonicalPortfolioReady=install();
})();