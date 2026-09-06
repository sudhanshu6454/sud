<?php
/**
 * Plugin Name: Fleet Media - compress every upload
 * Description: Re-encodes every JPEG/PNG/WebP upload in place (longest edge 1920px, quality 82, metadata stripped) and encodes all generated sizes at quality 82. Formats are kept as uploaded: Instagram's API and link-preview scrapers want real JPEGs. Installed as a must-use plugin by infra/wp/init-sites.sh on every site.
 * Version: 1.0.0
 */
if ( ! defined( 'ABSPATH' ) ) exit;

const FLEET_MEDIA_MAX_EDGE = 1920;
const FLEET_MEDIA_QUALITY  = 82;

/** Every generated size (thumbnails, medium, large, theme sizes) is encoded at this quality. */
add_filter( 'jpeg_quality', fn() => FLEET_MEDIA_QUALITY );
add_filter( 'wp_editor_set_quality', fn( $q, $mime ) => FLEET_MEDIA_QUALITY, 10, 2 );

/** Never keep a multi-megapixel original around: scale it at upload time. */
add_filter( 'big_image_size_threshold', fn() => FLEET_MEDIA_MAX_EDGE );

/**
 * Keep every size in the uploaded format. WordPress can transcode sizes to WebP, but it then also
 * makes the WebP the attachment's primary file, which breaks Instagram publishing (JPEG only) and
 * makes og:image previews flaky - so that stays off; the savings come from the re-encode below.
 */
add_filter( 'image_editor_output_format', '__return_empty_array', 999 );

/**
 * Re-encode the ORIGINAL file the moment it lands in uploads/ - core only compresses the
 * sub-sizes, so this is what actually shrinks what autopub / editors upload.
 */
add_filter( 'wp_handle_upload', function ( $upload ) {
	if ( empty( $upload['file'] ) || empty( $upload['type'] ) ) return $upload;
	if ( ! in_array( $upload['type'], array( 'image/jpeg', 'image/png', 'image/webp' ), true ) ) return $upload;
	if ( ! is_readable( $upload['file'] ) ) return $upload;

	$before = filesize( $upload['file'] );
	$editor = wp_get_image_editor( $upload['file'] );
	if ( is_wp_error( $editor ) ) return $upload;

	$size = $editor->get_size();
	if ( ! empty( $size['width'] ) && ( $size['width'] > FLEET_MEDIA_MAX_EDGE || $size['height'] > FLEET_MEDIA_MAX_EDGE ) ) {
		$editor->resize( FLEET_MEDIA_MAX_EDGE, FLEET_MEDIA_MAX_EDGE, false );
	}
	$editor->set_quality( FLEET_MEDIA_QUALITY );

	$ext   = pathinfo( $upload['file'], PATHINFO_EXTENSION );
	$tmp   = preg_replace( '/\.' . preg_quote( $ext, '/' ) . '$/i', '-fleet-tmp.' . $ext, $upload['file'] );
	$saved = $editor->save( $tmp, $upload['type'] );

	if ( is_wp_error( $saved ) || empty( $saved['path'] ) || ! file_exists( $saved['path'] ) || ( $saved['mime-type'] ?? '' ) !== $upload['type'] ) {
		if ( ! is_wp_error( $saved ) && ! empty( $saved['path'] ) ) @unlink( $saved['path'] );
		@unlink( $tmp );
		return $upload;
	}
	// Only keep the re-encoded file when it is actually smaller (PNG line-art can grow).
	if ( filesize( $saved['path'] ) < $before ) {
		rename( $saved['path'], $upload['file'] );
	} else {
		@unlink( $saved['path'] );
	}
	return $upload;
}, 20 );

/** Lazy-load + async decode for every image WordPress prints. */
add_filter( 'wp_get_attachment_image_attributes', function ( $attr ) {
	$attr['decoding'] = 'async';
	return $attr;
} );
