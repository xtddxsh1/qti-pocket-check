/* Self-authored synthetic examples. No publisher or real examination content. MIT. */
(function (root, factory) {
  const fixtures = factory();
  if (typeof module === 'object' && module.exports) module.exports = fixtures;
  else root.QtiSyntheticFixtures = fixtures;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const header = '<?xml version="1.0" encoding="UTF-8"?>';
  const manifest = (href) => `${header}<manifest identifier="synthetic-manifest" xmlns="http://www.imsglobal.org/xsd/imscp_v1p1"><resources><resource identifier="synthetic-resource" type="imsqti_xmlv1p2" href="${href}"><file href="${href}"/></resource></resources></manifest>`;
  const legacy = (attribute) => `${header}<questestinterop xmlns="http://www.imsglobal.org/xsd/ims_qtiasiv1p2"><assessment ident="synthetic-assessment"><section ident="synthetic-section"><item ident="synthetic-item-1"><presentation><material><mattext>Synthetic sample only.</mattext></material><response_lid ident="synthetic-response-1" ${attribute}><render_choice><response_label ident="A"><material><mattext>Sample A</mattext></material></response_label></render_choice></response_lid></presentation></item></section></assessment></questestinterop>`;
  return {
    good: {'imsmanifest.xml':manifest('items.xml'),'items.xml':legacy('rcardinality="Single"')},
    bad: {'imsmanifest.xml':`${header}<manifest identifier="synthetic-bad" xmlns="http://www.imsglobal.org/xsd/imscp_v1p1"><resources><resource identifier="quiz" type="imsqti_xmlv1p2" href="items.xml"><file href="items.xml"/><file href="missing-image.png"/></resource></resources></manifest>`,'items.xml':legacy('')},
    nested: {'chapter/imsmanifest.xml':manifest('item.xml'),'chapter/item.xml':`${header}<assessmentItem xmlns="http://www.imsglobal.org/xsd/imsqti_v2p1" identifier="synthetic-qti21" title="Synthetic item" adaptive="false" timeDependent="false"><itemBody><p>Synthetic sample only.</p></itemBody></assessmentItem>`},
    entity: {'imsmanifest.xml':manifest('items.xml'),'items.xml':'<?xml version="1.0"?><!DOCTYPE questestinterop [<!ENTITY sample "DO NOT EXPAND">]><questestinterop><item ident="synthetic-entity">&sample;</item></questestinterop>'},
    malformed: {'imsmanifest.xml':manifest('items.xml'),'items.xml':'<questestinterop><item ident="broken"></questestinterop>'}
  };
});
