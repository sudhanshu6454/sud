/* Marketing Mentalist admin: carousel image picker (wp.media), no build step. */
jQuery(function ($) {
  'use strict';
  var frame;
  $('#mm_pick_carousel').on('click', function (e) {
    e.preventDefault();
    if (!frame) {
      frame = wp.media({ title: 'Select carousel images', button: { text: 'Use these' }, multiple: true });
      frame.on('select', function () {
        var ids = frame.state().get('selection').map(function (a) { return a.id; });
        $('#mm_carousel_ids').val(ids.join(','));
        var $preview = $('#mm_carousel_preview').empty();
        frame.state().get('selection').each(function (a) {
          var url = (a.attributes.sizes && a.attributes.sizes.thumbnail) ? a.attributes.sizes.thumbnail.url : a.attributes.url;
          $preview.append($('<img>').attr('src', url).css({ width: 64, height: 80, objectFit: 'cover' }));
        });
      });
    }
    frame.open();
  });
});
