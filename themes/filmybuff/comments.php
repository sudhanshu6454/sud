<?php if ( post_password_required() ) return; ?>
<div id="comments" class="comments-area">
	<?php if ( have_comments() ) : ?>
		<h3 class="widget-title"><?php printf( esc_html( _n( '%s comment', '%s comments', get_comments_number(), 'filmybuff' ) ), esc_html( number_format_i18n( get_comments_number() ) ) ); ?></h3>
		<ol class="comment-list"><?php wp_list_comments( array( 'style' => 'ol', 'short_ping' => true, 'avatar_size' => 40 ) ); ?></ol>
		<?php the_comments_navigation(); ?>
	<?php endif; ?>
	<?php if ( comments_open() ) comment_form( array( 'class_submit' => 'btn', 'title_reply' => __( 'Have your say', 'filmybuff' ) ) ); ?>
</div>
