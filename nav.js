const NAV = [
  {
    group: '基础世界观',
    items: [
      { id:'greystar', title:'灰星', badge:'必读',
        sub:[
          { id:'greystar_past',       title:'过去' },
          { id:'greystar_company',    title:'公司' },
          { id:'greystar_enterprise', title:'企业' },
          { id:'greystar_scavenger',  title:'拾荒者' }
        ]
      },
      { id:'greycity', title:'灰都', badge:'必读',
        sub:[
          { id:'greycity_rings', title:'五环',
            sub:[
              { id:'greycity_core',   title:'核心 I（枢纽）' },
              { id:'greycity_corp',   title:'企业 II（公司 / 企业）' },
              { id:'greycity_bustle', title:'繁茂 III（商贸）' },
              { id:'greycity_mid',    title:'中城 IV（居民 / 轻工业）' },
              { id:'greycity_edge',   title:'边城 V（贫困 / 重工业）' }
            ]
          },
          { id:'greycity_facilities', title:'重要设施 / 公共服务' }
        ]
      },
      { id:'map', title:'世界地图',
        sub:[
          { id:'waterclaw', title:'水爪泽社区（大型聚居地）',
            sub:[
              { id:'waterclaw_intro', title:'简介' },
              { id:'waterclaw_infra', title:'基础设施' },
              { id:'waterclaw_force', title:'武装力量' },
              { id:'waterclaw_local', title:'当地特色' }
            ]
          }
        ]
      },
      { id:'union', title:'人联的过去（地球旧历）', note:'补充',
        sub:[
          { id:'union_period',  title:'人联会时期（旧世界历至三次战争时期）' },
          { id:'union_war',     title:'第三次战争' },
          { id:'union_founded', title:'人联' }
        ]
      },
      { id:'tech', title:'科技详解', note:'补充' }
    ]
  },
  {
    group: '优质游玩体验，了解如何生活',
    items: [
      { id:'currency',   title:'货币·生活' },
      { id:'guild',      title:'勘探者协会' },
      { id:'wilderness', title:'荒野与战利品' },
      { id:'gear',       title:'技术与装备' },
      { id:'defense',    title:'灰都防务' }
    ]
  },
  {
    group: '表格，创造属于你自己的设定',
    items: []
  }
];