<?php if ( post_password_required() ) return; ?>
<div id="comments" class="comments-area">
	<?php if ( have_comments() ) : ?>
		<h2 class="section-title"><span><?php printf( esc_html( _n( '%s comment', '%s comments', get_comments_number(), 'crazy4marketing' ) ), esc_html( number_format_i18n( get_comments_number() ) ) ); ?></span></h2>
		<ol class="comment-list" style="list-style:none;padding:0;margin:24px 0"><?php wp_list_comments( array( 'style' => 'ol', 'short_ping' => true, 'avatar_size' => 40 ) ); ?></ol>
		<?php the_comments_navigation(); ?>
	<?php endif;
	comment_form( array( 'class_submit' => 'btn', 'title_reply_before' => '<h3 class="section-title"><span>', 'title_reply_after' => '</span></h3>' ) ); ?>
</div>
