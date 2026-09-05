<?php
/**
 * Editorial fields for the custom post types - a native-WordPress substitute for ACF field
 * groups (HANDOVER.md §4), so the theme has no plugin dependency for its core content model.
 * Repeaters (assets, credits) use one "field|field|field" per line rather than a JS repeater -
 * simpler to build reliably and to edit by hand; the format is documented on each field.
 *
 * @package marketing-mentalist
 */

defined( 'ABSPATH' ) || exit;

const MM_SECTIONS = array(
	'the_campaign'  => 'The campaign',
	'the_brief'     => 'The brief',
	'the_idea'      => 'The idea',
	'the_insight'   => 'The insight',
	'the_execution' => 'The execution',
	'why_it_worked' => 'Why it worked',
);

function mm_admin_assets( string $hook ): void {
	global $post_type;
	if ( ! in_array( $post_type, array( 'mm_campaign', 'mm_breakdown', 'mm_take', 'mm_list' ), true ) ) {
		return;
	}
	wp_enqueue_media();
	wp_enqueue_script( 'mm-admin', MM_URI . '/assets/js/mm-admin.js', array( 'jquery' ), MM_VERSION, true );
}
add_action( 'admin_enqueue_scripts', 'mm_admin_assets' );

function mm_register_meta_boxes(): void {
	add_meta_box( 'mm_campaign_details', 'Campaign details', 'mm_box_campaign_details', 'mm_campaign', 'normal', 'high' );
	foreach ( MM_SECTIONS as $key => $label ) {
		add_meta_box( "mm_section_$key", $label, fn( $post ) => mm_box_section( $post, $key ), 'mm_campaign', 'normal' );
	}
	add_meta_box( 'mm_assets_credits', 'Assets, credits & carousel', 'mm_box_assets_credits', 'mm_campaign', 'normal' );

	foreach ( array( 'mm_breakdown', 'mm_take', 'mm_list' ) as $pt ) {
		add_meta_box( 'mm_standfirst', 'Standfirst & reading time', 'mm_box_standfirst', $pt, 'normal', 'high' );
	}
	foreach ( array( 'mm_brand', 'mm_agency' ) as $pt ) {
		add_meta_box( 'mm_org_details', 'Website', 'mm_box_org_details', $pt, 'normal' );
	}
	foreach ( array( 'mm_campaign', 'mm_breakdown', 'mm_take', 'mm_list', 'post' ) as $pt ) {
		add_meta_box( 'mm_toggles', 'Editorial flags', 'mm_box_toggles', $pt, 'side' );
	}
}
add_action( 'add_meta_boxes', 'mm_register_meta_boxes' );

function mm_field_nonce(): void {
	wp_nonce_field( 'mm_save_meta', 'mm_meta_nonce' );
}

function mm_text_row( string $key, string $label, string $value, string $type = 'text', string $help = '' ): void {
	printf(
		'<p><label for="%1$s"><strong>%2$s</strong></label><br><input type="%3$s" id="%1$s" name="%1$s" value="%4$s" style="width:100%%;max-width:520px" /> %5$s</p>',
		esc_attr( $key ), esc_html( $label ), esc_attr( $type ), esc_attr( $value ), $help ? '<span class="description">' . esc_html( $help ) . '</span>' : ''
	);
}

function mm_textarea_row( string $key, string $label, string $value, string $help = '', int $rows = 3 ): void {
	printf(
		'<p><label for="%1$s"><strong>%2$s</strong></label>%5$s<br><textarea id="%1$s" name="%1$s" rows="%3$d" style="width:100%%;max-width:640px">%4$s</textarea></p>',
		esc_attr( $key ), esc_html( $label ), $rows, esc_textarea( $value ), $help ? ' <span class="description">' . esc_html( $help ) . '</span>' : ''
	);
}

function mm_box_campaign_details( WP_Post $post ): void {
	mm_field_nonce();
	$brand_id = (int) get_post_meta( $post->ID, 'mm_brand_id', true );
	$agency_ids = array_map( 'intval', (array) get_post_meta( $post->ID, 'mm_agency_ids', true ) );
	echo '<p><label for="mm_brand_id"><strong>Brand</strong></label><br><select id="mm_brand_id" name="mm_brand_id">';
	echo '<option value="0">— none —</option>';
	foreach ( get_posts( array( 'post_type' => 'mm_brand', 'numberposts' => -1, 'orderby' => 'title', 'order' => 'ASC' ) ) as $b ) {
		printf( '<option value="%d" %s>%s</option>', $b->ID, selected( $brand_id, $b->ID, false ), esc_html( $b->post_title ) );
	}
	echo '</select></p>';

	echo '<p><label for="mm_agency_ids"><strong>Agency</strong> (Ctrl/Cmd-click to select several)</label><br><select id="mm_agency_ids" name="mm_agency_ids[]" multiple size="4" style="min-width:280px">';
	foreach ( get_posts( array( 'post_type' => 'mm_agency', 'numberposts' => -1, 'orderby' => 'title', 'order' => 'ASC' ) ) as $a ) {
		printf( '<option value="%d" %s>%s</option>', $a->ID, selected( in_array( $a->ID, $agency_ids, true ), true, false ), esc_html( $a->post_title ) );
	}
	echo '</select></p>';

	mm_text_row( 'mm_launch_date', 'Launch date', get_post_meta( $post->ID, 'mm_launch_date', true ), 'date' );

	echo '<p><label><strong>Hero media</strong></label></p>';
	$hero_type = get_post_meta( $post->ID, 'mm_hero_type', true ) ?: 'image';
	echo '<p><select name="mm_hero_type">';
	foreach ( array( 'image' => 'Image (uses the featured image)', 'youtube' => 'YouTube', 'vimeo' => 'Vimeo', 'mp4' => 'MP4 URL', 'instagram' => 'Instagram' ) as $val => $label ) {
		printf( '<option value="%s" %s>%s</option>', esc_attr( $val ), selected( $hero_type, $val, false ), esc_html( $label ) );
	}
	echo '</select></p>';
	mm_text_row( 'mm_hero_url', 'Hero video/embed URL (ignored for Image)', get_post_meta( $post->ID, 'mm_hero_url', true ), 'url' );

	mm_textarea_row( 'mm_summary', 'Summary', get_post_meta( $post->ID, 'mm_summary', true ), '≤240 characters. Feeds the excerpt and og:description if the excerpt is empty.', 2 );
	mm_textarea_row( 'mm_take', 'Mentalist take', get_post_meta( $post->ID, 'mm_take', true ), '≤200 characters. Renders as the .mm-take highlight block.', 2 );

	$sponsor = get_post_meta( $post->ID, 'mm_sponsor_label', true );
	echo '<p><label for="mm_sponsor_label"><strong>Sponsor label</strong></label><br><select id="mm_sponsor_label" name="mm_sponsor_label">';
	foreach ( array( '' => '— not sponsored —', 'Paid partnership' => 'Paid partnership', 'Partner content' => 'Partner content' ) as $val => $label ) {
		printf( '<option value="%s" %s>%s</option>', esc_attr( $val ), selected( $sponsor, $val, false ), esc_html( $label ) );
	}
	echo '</select> <span class="description">Also tag the post "sponsored" - that tag is what actually flips disclosure and rel=sponsored on, fleet-wide.</span></p>';
}

function mm_box_section( WP_Post $post, string $key ): void {
	mm_field_nonce();
	wp_editor( get_post_meta( $post->ID, "mm_$key", true ), "mm_$key", array( 'textarea_name' => "mm_$key", 'textarea_rows' => 6, 'media_buttons' => false ) );
}

function mm_box_assets_credits( WP_Post $post ): void {
	mm_field_nonce();
	$ids = array_filter( array_map( 'intval', explode( ',', (string) get_post_meta( $post->ID, 'mm_carousel_ids', true ) ) ) );
	echo '<p><label><strong>Carousel</strong> (4:5 slides, 5-10 images)</label><br>';
	echo '<input type="hidden" id="mm_carousel_ids" name="mm_carousel_ids" value="' . esc_attr( implode( ',', $ids ) ) . '">';
	echo '<div id="mm_carousel_preview" style="display:flex;gap:6px;flex-wrap:wrap;margin:8px 0">';
	foreach ( $ids as $id ) {
		$src = wp_get_attachment_image_url( $id, 'thumbnail' );
		if ( $src ) {
			printf( '<img src="%s" style="width:64px;height:80px;object-fit:cover">', esc_url( $src ) );
		}
	}
	echo '</div><button type="button" class="button" id="mm_pick_carousel">Select images…</button></p>';

	mm_textarea_row( 'mm_assets', 'Assets', mm_kv_to_lines( get_post_meta( $post->ID, 'mm_assets', true ) ),
		'One per line: type|url|caption - type is image, youtube, instagram, x or mp4.', 5 );
	mm_textarea_row( 'mm_credits', 'Credits', mm_kv_to_lines( get_post_meta( $post->ID, 'mm_credits', true ) ),
		'One per line: role|name|link (link optional) - role is Brand, Creative agency, Media agency, Production house, Director, PR agency, Talent or Other.', 6 );
}

function mm_box_standfirst( WP_Post $post ): void {
	mm_field_nonce();
	mm_textarea_row( 'mm_standfirst', 'Standfirst', get_post_meta( $post->ID, 'mm_standfirst', true ), '', 3 );
	mm_text_row( 'mm_reading_time', 'Reading time override (minutes)', get_post_meta( $post->ID, 'mm_reading_time', true ), 'number', 'Leave blank to compute from word count.' );
	mm_text_row( 'mm_updated_note', 'Updated note', get_post_meta( $post->ID, 'mm_updated_note', true ), 'text', 'e.g. "Added the Q3 numbers"' );
}

function mm_box_org_details( WP_Post $post ): void {
	mm_field_nonce();
	mm_text_row( 'mm_website', 'Website', get_post_meta( $post->ID, 'mm_website', true ), 'url' );
}

function mm_box_toggles( WP_Post $post ): void {
	mm_field_nonce();
	foreach ( array( 'mm_featured_home' => 'Feature on homepage', 'mm_is_trending' => 'Trending', 'mm_in_newsletter' => 'Include in newsletter' ) as $key => $label ) {
		printf(
			'<p><label><input type="checkbox" name="%1$s" value="1" %2$s /> %3$s</label></p>',
			esc_attr( $key ), checked( get_post_meta( $post->ID, $key, true ), '1', false ), esc_html( $label )
		);
	}
}

function mm_kv_to_lines( $value ): string {
	if ( ! is_array( $value ) ) {
		return '';
	}
	return implode( "\n", array_map( fn( $row ) => implode( '|', $row ), $value ) );
}

function mm_lines_to_kv( string $text, array $keys ): array {
	$out = array();
	foreach ( preg_split( '/\r?\n/', trim( $text ) ) as $line ) {
		$line = trim( $line );
		if ( '' === $line ) {
			continue;
		}
		$parts = array_pad( array_map( 'trim', explode( '|', $line, count( $keys ) ) ), count( $keys ), '' );
		$out[] = array_combine( $keys, $parts );
	}
	return $out;
}

function mm_save_meta( int $post_id ): void {
	if ( ! isset( $_POST['mm_meta_nonce'] ) || ! wp_verify_nonce( sanitize_text_field( wp_unslash( $_POST['mm_meta_nonce'] ) ), 'mm_save_meta' ) ) {
		return;
	}
	if ( defined( 'DOING_AUTOSAVE' ) && DOING_AUTOSAVE ) {
		return;
	}
	if ( ! current_user_can( 'edit_post', $post_id ) ) {
		return;
	}

	if ( isset( $_POST['mm_brand_id'] ) ) {
		update_post_meta( $post_id, 'mm_brand_id', (int) $_POST['mm_brand_id'] );
	}
	if ( isset( $_POST['mm_agency_ids'] ) ) {
		update_post_meta( $post_id, 'mm_agency_ids', array_map( 'intval', (array) $_POST['mm_agency_ids'] ) );
	} elseif ( isset( $_POST['mm_meta_nonce'] ) && 'mm_campaign' === get_post_type( $post_id ) ) {
		update_post_meta( $post_id, 'mm_agency_ids', array() );
	}

	foreach ( array( 'mm_launch_date', 'mm_hero_type', 'mm_hero_url', 'mm_sponsor_label', 'mm_website', 'mm_reading_time', 'mm_updated_note' ) as $key ) {
		if ( isset( $_POST[ $key ] ) ) {
			update_post_meta( $post_id, $key, sanitize_text_field( wp_unslash( $_POST[ $key ] ) ) );
		}
	}
	foreach ( array( 'mm_summary', 'mm_take', 'mm_standfirst' ) as $key ) {
		if ( isset( $_POST[ $key ] ) ) {
			update_post_meta( $post_id, $key, sanitize_textarea_field( wp_unslash( $_POST[ $key ] ) ) );
		}
	}
	foreach ( array_keys( MM_SECTIONS ) as $key ) {
		$field = "mm_$key";
		if ( isset( $_POST[ $field ] ) ) {
			update_post_meta( $post_id, $field, wp_kses_post( wp_unslash( $_POST[ $field ] ) ) );
		}
	}
	if ( isset( $_POST['mm_carousel_ids'] ) ) {
		$ids = array_filter( array_map( 'intval', explode( ',', sanitize_text_field( wp_unslash( $_POST['mm_carousel_ids'] ) ) ) ) );
		update_post_meta( $post_id, 'mm_carousel_ids', implode( ',', $ids ) );
	}
	if ( isset( $_POST['mm_assets'] ) ) {
		update_post_meta( $post_id, 'mm_assets', mm_lines_to_kv( wp_unslash( $_POST['mm_assets'] ), array( 'type', 'url', 'caption' ) ) );
	}
	if ( isset( $_POST['mm_credits'] ) ) {
		update_post_meta( $post_id, 'mm_credits', mm_lines_to_kv( wp_unslash( $_POST['mm_credits'] ), array( 'role', 'name', 'link' ) ) );
	}
	foreach ( array( 'mm_featured_home', 'mm_is_trending', 'mm_in_newsletter' ) as $key ) {
		update_post_meta( $post_id, $key, isset( $_POST[ $key ] ) ? '1' : '' );
	}
}
add_action( 'save_post', 'mm_save_meta' );
